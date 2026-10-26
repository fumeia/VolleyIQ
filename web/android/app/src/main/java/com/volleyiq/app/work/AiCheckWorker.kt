package com.volleyiq.app.work

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The AI check of every rally, as a foreground job: for each detected touch three frames
 * (just before, at, just after the sound) go to the server's AI check, and the answers are
 * kept with the suggestions there. It goes on when you switch apps; the notification shows
 * the rally and about how long is left. Same pictures and requests as the check in Review.
 *
 * The job file (written by the app) is JSON: { matchId, apiBase, token, uri, examples,
 * roster: [{number, role}], rallies: [{ ourSide, touches: [{ id, t }] }] }.
 */
class AiCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val notificationId = 6000 + (id.hashCode() and 0xfff) * 2

    override suspend fun getForegroundInfo() = Notifications.foreground(applicationContext, notificationId, "AI check", "Starting…", null)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val jobFile = File(inputData.getString(KEY_JOB) ?: return@withContext Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "No job")))
        val job = runCatching { JSONObject(jobFile.readText()) }.getOrNull()
            ?: return@withContext Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Job file missing"))
        setForeground(getForegroundInfo())
        val apiBase = job.getString("apiBase").trimEnd('/')
        val token = job.optString("token").takeIf { it.isNotBlank() && it != "null" }
        val matchId = job.getLong("matchId")
        val rallies = job.getJSONArray("rallies")
        val retriever = MediaMetadataRetriever()
        try {
            val uri = job.getString("uri")
            if (uri.startsWith("/")) retriever.setDataSource(uri) else retriever.setDataSource(applicationContext, Uri.parse(uri))
            val start = System.currentTimeMillis()
            var done = 0
            for (r in 0 until rallies.length()) {
                if (isStopped) throw java.util.concurrent.CancellationException()
                val rally = rallies.getJSONObject(r)
                val touches = rally.getJSONArray("touches")
                val n = minOf(16, touches.length())
                if (n > 0) {
                    val images = JSONArray()
                    for (k in 0 until n) {
                        val t = touches.getJSONObject(k).getDouble("t")
                        images.put(JSONObject().put("media_type", "image/jpeg").put("data", picture(retriever, t, "Touch ${k + 1} of $n")))
                    }
                    val body = JSONObject().put("images", images).put("ourSide", rally.opt("ourSide") ?: JSONObject.NULL)
                        .put("roster", job.optJSONArray("roster") ?: JSONArray()).put("examples", job.optBoolean("examples"))
                    val (code, text) = post("$apiBase/api/ai/touches", body, token)
                    if (code == 429 || code == 402 || (code >= 400 && text.contains("budget", ignoreCase = true))) {
                        val msg = runCatching { JSONObject(text).optString("error") }.getOrNull()?.takeIf { it.isNotBlank() } ?: "The AI refused more checks (limit or credit)"
                        Notifications.done(applicationContext, notificationId, "AI check stopped", "$done of ${rallies.length()} rallies checked · $msg")
                        return@withContext Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to msg, AnalysisWorker.KEY_COUNT to done))
                    }
                    if (code in 200..299) {
                        // Answers with the touch they belong to, kept with the suggestions on the server.
                        val answers = JSONObject(text).optJSONArray("touches") ?: JSONArray()
                        val results = JSONArray()
                        for (a in 0 until answers.length()) {
                            val ans = answers.getJSONObject(a)
                            val i = ans.optInt("i", 0)
                            if (i < 1 || i > n) continue
                            ans.put("ourSide", rally.opt("ourSide") ?: JSONObject.NULL)
                            results.put(JSONObject().put("id", touches.getJSONObject(i - 1).getLong("id")).put("ai", ans))
                        }
                        post("$apiBase/api/matches/$matchId/ai", JSONObject().put("results", results), token)
                    }
                    // Other failures (a gateway hiccup): leave this rally unchecked and go on.
                }
                done++
                val elapsed = (System.currentTimeMillis() - start) / 1000.0
                val left = UpdateWorker.left(elapsed / done * (rallies.length() - done))
                val text = "Rally $done of ${rallies.length()} · $left"
                setProgress(workDataOf(AnalysisWorker.KEY_PROGRESS to done.toDouble() / rallies.length(), AnalysisWorker.KEY_MESSAGE to text))
                setForeground(Notifications.foreground(applicationContext, notificationId, "AI check", text, done.toDouble() / rallies.length()))
            }
            jobFile.delete()
            Notifications.done(applicationContext, notificationId, "AI check finished", "$done rallies checked. Open VolleyIQ to review")
            Result.success(workDataOf(AnalysisWorker.KEY_COUNT to done))
        } catch (e: java.util.concurrent.CancellationException) {
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Stopped"))
        } catch (e: Exception) {
            Notifications.done(applicationContext, notificationId, "AI check failed", e.message ?: e.javaClass.simpleName)
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to (e.message ?: e.javaClass.simpleName)))
        } finally {
            retriever.release()
        }
    }

    /** One 2x2 picture: frames 0.3 s before, at and 0.2 s after the sound, and a label; JPEG, base64. */
    private fun picture(r: MediaMetadataRetriever, t: Double, label: String): String {
        val cw = 640; val ch = 360
        val out = Bitmap.createBitmap(cw * 2, ch * 2, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out).apply { drawColor(Color.BLACK) }
        listOf(-0.3, 0.0, 0.2).forEachIndexed { j, dt ->
            val us = ((t + dt).coerceAtLeast(0.0) * 1_000_000).toLong()
            val f = r.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST, cw, ch) ?: return@forEachIndexed
            val s = minOf(cw.toFloat() / f.width, ch.toFloat() / f.height)
            val w = (f.width * s).toInt(); val h = (f.height * s).toInt()
            val x = (j % 2) * cw + (cw - w) / 2; val y = (j / 2) * ch + (ch - h) / 2
            canvas.drawBitmap(f, null, Rect(x, y, x + w, y + h), null)
            f.recycle()
        }
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 44f; isFakeBoldText = true }
        canvas.drawText(label, cw + 30f, ch + 90f, paint)
        paint.apply { textSize = 26f; isFakeBoldText = false }
        canvas.drawText("top left: 0.3 s before · top right: at the sound", cw + 30f, ch + 150f, paint)
        canvas.drawText("bottom left: 0.2 s after", cw + 30f, ch + 190f, paint)
        val bytes = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, 65, it) }.toByteArray()
        out.recycle()
        return Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    private fun post(url: String, body: JSONObject, token: String?): Pair<Int, String> {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 180_000
            setRequestProperty("Content-Type", "application/json")
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
        }
        return try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            code to ((if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty())
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        const val KEY_JOB = "job"
    }
}
