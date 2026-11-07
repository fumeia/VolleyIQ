package com.volleyiq.app.work

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.volleyiq.app.analysis.CheckpointStore
import com.volleyiq.app.analysis.CourtSides
import com.volleyiq.app.analysis.Detection
import com.volleyiq.app.analysis.SoundModel
import com.volleyiq.app.analysis.Homography
import com.volleyiq.app.analysis.P
import com.volleyiq.app.analysis.Rallies
import com.volleyiq.app.analysis.VisionResult
import com.volleyiq.app.media.FrameSampler
import com.volleyiq.app.media.MediaScan
import com.volleyiq.app.media.TouchVision
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * First, automatic pass over a match video, run entirely on the phone as a
 * foreground job (keeps going when the app is in the background):
 * audio contacts + whistles -> edit cuts -> rallies -> optional vision
 * (jersey numbers, court side) -> suggestions file for [UploadWorker].
 */
class AnalysisWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val matchId = inputData.getLong(KEY_MATCH, 0)
    private val notificationId = 1000 + (matchId % 10_000).toInt() * 2
    private var lastReported = -1

    override suspend fun getForegroundInfo() = Notifications.foreground(applicationContext, notificationId, "Analysing match", "Starting…", null)

    override suspend fun doWork(): Result = withContext(Dispatchers.Default) {
        val uri = Uri.parse(inputData.getString(KEY_URI) ?: return@withContext Result.failure(workDataOf(KEY_ERROR to "No video")))
        val roster = (inputData.getIntArray(KEY_ROSTER) ?: IntArray(0)).toSet()
        val readJerseys = inputData.getBoolean(KEY_JERSEYS, true)
        val detectCuts = inputData.getBoolean(KEY_CUTS, true)
        val sensitivity = inputData.getDouble(KEY_SENSITIVITY, 1.0)
        // Learned from tagged matches on the server (or the defaults).
        val threshold = inputData.getDouble(KEY_THRESHOLD, Detection.DEFAULT_THRESHOLD)
        val sustainMax = inputData.getDouble(KEY_SUSTAIN, Detection.DEFAULT_SUSTAIN)
        // The touch model trained on the tagged matches, when the server has one that beats the thresholds.
        val model = SoundModel.parse(inputData.getString(KEY_MODEL))
        // A match already tagged: the run is only for learning (no suggestions, no picture reading).
        val learnOnly = inputData.getBoolean(KEY_LEARN_ONLY, false)
        val ourHalf = inputData.getString(KEY_OUR_HALF)
        // Calibration: flat [u, v, x, y] per tapped landmark (image position -> court meters).
        val calibration = inputData.getDoubleArray(KEY_POINTS)?.takeIf { it.size >= 16 && it.size % 4 == 0 }
        val single = calibration?.let { a ->
            val n = a.size / 4
            Homography.fromPoints((0 until n).map { P(a[4 * it], a[4 * it + 1]) }, (0 until n).map { P(a[4 * it + 2], a[4 * it + 3]) })
        } ?: inputData.getDoubleArray(LEGACY_CORNERS)?.takeIf { it.size == 8 } // jobs queued by older app versions
            ?.let { c -> Homography.fromCorners((0 until 4).map { P(c[2 * it], c[2 * it + 1]) }) }
        // Per set (teams switch sides): one court marking and side per stretch of the video.
        val segmentsJson = inputData.getString(KEY_SEGMENTS)
        val sides = CourtSides.parse(segmentsJson) ?: CourtSides.single(single, ourHalf)

        // Saved progress for this video: survives app updates, reboots and Android stopping the job.
        val cacheRoot = File(applicationContext.filesDir, "analysis-checkpoints")
        val checkpoints = CheckpointStore(cacheRoot, videoIdentity(uri))
        CheckpointStore.prune(cacheRoot)

        setForeground(getForegroundInfo())
        try {
            val feat = checkpoints.loadFeatures()?.also { report(0.35, "Sound already analysed, continuing") }
                ?: MediaScan.audioFeatures(applicationContext, uri, { report(0.02 + 0.33 * it, "Listening for ball contacts") }, ::isStopped)
                    .also(checkpoints::saveFeatures)
            val whistles = Detection.whistles(feat)
            // Every sound peak, also below the threshold, with its measurements: the server learns from them.
            val candidates = Detection.candidates(feat, whistles)
            val contacts = model?.contacts(candidates, sensitivity)
                ?: Detection.contacts(feat, sensitivity, whistles = whistles, threshold = threshold, sustainMax = sustainMax)
            // Faint sounds (mostly far-side touches): only used to fill holes in a rally's rhythm.
            val quiet = Rallies.quietContacts(contacts, model?.contacts(candidates, sensitivity * Rallies.QUIET_BOOST)
                ?: Detection.contacts(feat, sensitivity * Rallies.QUIET_BOOST, whistles = whistles, threshold = threshold, sustainMax = sustainMax))

            val cuts = if (detectCuts) {
                val diffs = checkpoints.loadDiffs()?.also { report(0.6, "Edit cuts already found, continuing") }
                    ?: MediaScan.frameDiffs(applicationContext, uri, { report(0.35 + 0.25 * it, "Looking for edit cuts") }, ::isStopped)
                        .also(checkpoints::saveDiffs)
                Detection.cuts(diffs, MediaScan.DIFF_FPS)
            } else emptyList()

            val rallies = Rallies.segment(contacts, whistles, cuts)
            val interval = Rallies.typicalInterval(rallies)
            rallies.forEach { Rallies.fillGaps(it, quiet, interval) }
            val touches = rallies.flatMap { it.touches }
            val added = touches.count { it.kind != Rallies.HEARD }
            report(0.6, "${rallies.size} rallies, ${touches.size} touches ($added filled in)")

            if (!learnOnly && (readJerseys || sides.hasCourt) && touches.isNotEmpty()) {
                // Results depend on these settings; a different variant starts its own checkpoint.
                val variant = "v2|jerseys=$readJerseys|roster=${roster.sorted()}|cal=${segmentsJson ?: (calibration ?: inputData.getDoubleArray(LEGACY_CORNERS))?.joinToString(",")}"
                val done = checkpoints.loadVision(variant)
                val resumed = touches.count { CheckpointStore.touchKey(it.t) in done }
                // Every frame still needed, in video order; touches already in the checkpoint are skipped.
                val todo = touches.indices.filter { CheckpointStore.touchKey(touches[it].t) !in done }
                val requests = todo.flatMap { ti -> TouchVision.OFFSETS.map { dt -> ti to ((touches[ti].t + dt).coerceAtLeast(0.0) * 1_000_000).toLong() } }
                    .sortedBy { it.second }
                val evidence = HashMap<Int, TouchVision.Evidence>()
                val framesLeft = HashMap<Int, Int>().apply { todo.forEach { put(it, TouchVision.OFFSETS.size) } }
                var unsaved = 0
                fun finish(ti: Int, vision: TouchVision) {
                    val r = vision.result(evidence.remove(ti) ?: TouchVision.Evidence())
                    done[CheckpointStore.touchKey(touches[ti].t)] = VisionResult(r.jersey, r.jerseyConf, r.pos, r.ball)
                    if (++unsaved >= 10) { checkpoints.saveVision(variant, done); unsaved = 0 }
                }
                if (requests.isNotEmpty()) {
                    val started = System.nanoTime()
                    TouchVision(applicationContext, readJerseys).use { vision ->
                        try {
                            FrameSampler.sample(
                                applicationContext, uri, LongArray(requests.size) { requests[it].second }, 1920,
                                onFrame = { targets, frame ->
                                    for (k in targets) {
                                        val ti = requests[k].first
                                        vision.look(frame, roster, evidence.getOrPut(ti) { TouchVision.Evidence() }, sides.homography(touches[ti].t),
                                            zoom = touches[ti].kind != Rallies.HEARD)
                                        val left = framesLeft.getValue(ti) - 1
                                        framesLeft[ti] = left
                                        if (left == 0) finish(ti, vision)
                                    }
                                },
                                onProgress = { f ->
                                    val now = (todo.size * f).toInt()
                                    val n = resumed + now
                                    val note = if (resumed > 0) " ($resumed from before)" else ""
                                    report(0.6 + 0.37 * n / touches.size, "Looking at players $n/${touches.size}$note${speedNote(vision, now, started, touches.size - n)}")
                                },
                                isStopped = ::isStopped,
                            )
                            // Frames past the end of the video: finish with what was seen.
                            framesLeft.filterValues { it > 0 }.keys.forEach { finish(it, vision) }
                        } finally {
                            if (unsaved > 0) checkpoints.saveVision(variant, done)
                        }
                    }
                }
                for (t in touches) {
                    val r = done[CheckpointStore.touchKey(t.t)] ?: continue
                    t.jersey = r.jersey
                    t.jerseyConf = r.jerseyConf
                    t.pos = r.pos
                    t.ball = r.ball
                }
                rallies.forEach(Rallies::applyVision)
            }
            // Labels come last: filled-in touches and dropped bounces change which touch is the serve, set, …
            rallies.forEach(Rallies::label)
            if (readJerseys || sides.hasCourt) rallies.forEach { Rallies.assignTeams(it, roster, sides.ourHalf(it.touches[0].t)) }

            val events = Rallies.toEvents(rallies, sides::ourHalf, sides::setNo).map { e ->
                // Numbers not on our roster are opponents or misreads; keep the touch, drop the number.
                val jersey = e["jersey"] as Int?
                if (jersey != null && roster.isNotEmpty() && jersey !in roster) e + ("jersey" to null) else e
            }
            val file = File(applicationContext.filesDir, "suggestions-$matchId.json")
            file.writeText(JSONArray(events.map { JSONObject(it.filterValues { v -> v != null }) }).toString())
            // The run's settings go along with the results, to compare runs on the server.
            // Every peak with all its measurements (the server learns the thresholds and the touch model from them).
            File(file.path + ".candidates.json").writeText(JSONArray(candidates.map { c ->
                JSONArray().apply {
                    put(Math.round(c[0] * 100) / 100.0)
                    put(Math.round(c[1] * 10) / 10.0)
                    for (k in 2 until c.size) put(Math.round(c[k] * 1000) / 1000.0)
                }
            }).toString())
            File(file.path + ".params.json").writeText(JSONObject()
                .put("sensitivity", sensitivity).put("threshold", threshold).put("sustainMax", sustainMax).put("model", model != null).put("learnOnly", learnOnly).put("readJerseys", readJerseys).put("detectCuts", detectCuts)
                .put("courtMarked", single != null || segmentsJson != null).put("roster", roster.size).toString())
            Notifications.done(applicationContext, notificationId, "Analysis finished", "${events.size} touches suggested. Open VolleyIQ to review")
            Result.success(workDataOf(KEY_FILE to file.absolutePath, KEY_COUNT to events.size, KEY_RALLIES to rallies.size))
        } catch (e: java.util.concurrent.CancellationException) {
            Result.failure(workDataOf(KEY_ERROR to "Cancelled"))
        } catch (e: Exception) {
            Notifications.done(applicationContext, notificationId, "Analysis failed", e.message ?: e.javaClass.simpleName)
            Result.failure(workDataOf(KEY_ERROR to (e.message ?: e.javaClass.simpleName)))
        }
    }

    /** Same video file = same key, even when it is picked again under a new content:// URI. */
    private fun videoIdentity(uri: Uri): String {
        var name = uri.toString()
        var size = -1L
        if (uri.scheme == "file") {
            val f = File(uri.path ?: "")
            return "${f.name}|${f.length()}|${f.lastModified()}"
        }
        runCatching {
            applicationContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getString(0)?.let { name = it }
                    size = c.getLong(1)
                }
            }
        }
        return if (size > 0) "$name|$size" else uri.toString()
    }

    /** Time left, seconds per touch and where they go: " · ~25 min left · 1.9 s/touch (players 0.8, numbers 0.7, video 0.4)". */
    private fun speedNote(v: TouchVision, done: Int, startedNs: Long, left: Int): String {
        if (done < 20) return ""
        fun s(ns: Long) = "%.1f".format(ns / 1e9 / done)
        val total = System.nanoTime() - startedNs
        val video = total - v.detectNs - v.zoomNs - v.ocrNs
        val minutes = Math.round(total / 1e9 / done * left / 60)
        return " · ~$minutes min left · ${s(total)} s/touch (players ${s(v.detectNs + v.zoomNs)}, numbers ${s(v.ocrNs)}, video ${s(video)})"
    }

    private fun report(fraction: Double, message: String) {
        val pct = (fraction * 100).toInt()
        if (pct == lastReported) return
        lastReported = pct
        setProgressAsync(workDataOf(KEY_PROGRESS to fraction, KEY_MESSAGE to message))
        setForegroundAsync(Notifications.foreground(applicationContext, notificationId, "Analysing match", message, fraction))
    }

    companion object {
        const val KEY_MATCH = "matchId"
        const val KEY_URI = "uri"
        const val KEY_ROSTER = "roster"
        const val KEY_JERSEYS = "readJerseys"
        const val KEY_CUTS = "detectCuts"
        const val KEY_SENSITIVITY = "sensitivity"
        const val KEY_THRESHOLD = "threshold"
        const val KEY_SUSTAIN = "sustainMax"
        const val KEY_MODEL = "soundModel"
        const val KEY_LEARN_ONLY = "learnOnly"
        const val KEY_OUR_HALF = "ourHalf"
        const val KEY_POINTS = "calibrationPoints"
        /** JSON [{from, ourHalf, points}] per stretch of the video; newer than KEY_POINTS/KEY_OUR_HALF, which stay for set 1. */
        const val KEY_SEGMENTS = "calibrationSegments"
        private const val LEGACY_CORNERS = "corners"
        const val KEY_PROGRESS = "progress"
        const val KEY_MESSAGE = "message"
        const val KEY_ERROR = "error"
        const val KEY_FILE = "file"
        const val KEY_COUNT = "count"
        const val KEY_RALLIES = "rallies"
    }
}
