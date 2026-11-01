package com.volleyiq.app.work

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Uploads a match video from the phone straight into the team's bucket (the server only
 * signs each part), as a foreground job: it goes on in other apps, and after a lost
 * connection it continues where it stopped (the finished parts are kept in a small file).
 */
class VideoUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val matchId = inputData.getLong(KEY_MATCH, 0)
    private val notificationId = 7000 + (matchId.toInt() and 0xfff) * 2

    override suspend fun getForegroundInfo() = Notifications.foreground(applicationContext, notificationId, "Uploading the match video", "Starting…", null)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val uri = Uri.parse(inputData.getString(KEY_URI) ?: return@withContext Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "No video")))
        val apiBase = inputData.getString(UploadWorker.KEY_API)?.trimEnd('/') ?: return@withContext Result.failure()
        val token = inputData.getString(UploadWorker.KEY_TOKEN)
        setForeground(getForegroundInfo())
        val stateFile = File(applicationContext.filesDir, "video-upload-$matchId.json")
        try {
            val (size, name) = describe(uri)
            if (size <= 0) throw IllegalStateException("Could not read the video's size")
            // Resume the same file's upload, or start a new one.
            var state = runCatching { JSONObject(stateFile.readText()) }.getOrNull()
                ?.takeIf { it.optString("uri") == uri.toString() && it.optLong("size") == size }
            if (state == null) {
                val r = call("$apiBase/api/matches/$matchId/video/upload", JSONObject().put("size", size).put("name", name), token)
                state = JSONObject().put("uri", uri.toString()).put("size", size).put("key", r.getString("key"))
                    .put("uploadId", r.getString("uploadId")).put("partSize", r.getLong("partSize")).put("done", JSONObject())
                stateFile.writeText(state.toString())
            }
            val key = state.getString("key")
            val uploadId = state.getString("uploadId")
            val partSize = state.getLong("partSize")
            val done = state.getJSONObject("done")
            val parts = ((size + partSize - 1) / partSize).toInt()
            val todo = (1..parts).filter { !done.has(it.toString()) }

            val start = System.currentTimeMillis()
            var sent = 0L
            var stream: InputStream? = null
            var pos = 0L
            val buf = ByteArray(partSize.toInt())
            try {
                for (batch in todo.chunked(20)) {
                    val urls = call("$apiBase/api/matches/$matchId/video/parts",
                        JSONObject().put("key", key).put("uploadId", uploadId).put("parts", JSONArray(batch)), token).getJSONObject("urls")
                    for (n in batch) {
                        if (isStopped) throw java.util.concurrent.CancellationException()
                        val offset = (n - 1) * partSize
                        val len = minOf(partSize, size - offset).toInt()
                        // One stream through the file; reopened only when a part is skipped (resuming).
                        if (stream == null || pos != offset) {
                            stream?.close()
                            val opened = applicationContext.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Could not open the video")
                            var skip = offset
                            while (skip > 0) { val k = opened.skip(skip); if (k <= 0) break; skip -= k }
                            stream = opened
                            pos = offset
                        }
                        val input = stream!!
                        var read = 0
                        while (read < len) { val k = input.read(buf, read, len - read); if (k < 0) break; read += k }
                        if (read != len) throw IllegalStateException("The video ended early")
                        pos += len
                        val etag = put(urls.getString(n.toString()), buf, len)
                        done.put(n.toString(), etag)
                        stateFile.writeText(state.toString())
                        sent += len
                        val finished = done.length().toLong() * partSize
                        val speed = sent / ((System.currentTimeMillis() - start) / 1000.0).coerceAtLeast(0.5)
                        val text = "${mb(minOf(finished, size))} of ${mb(size)} MB · ${UpdateWorker.left((size - minOf(finished, size)) / speed.coerceAtLeast(1.0))}"
                        setProgress(workDataOf(AnalysisWorker.KEY_PROGRESS to minOf(1.0, finished.toDouble() / size), AnalysisWorker.KEY_MESSAGE to text))
                        setForeground(Notifications.foreground(applicationContext, notificationId, "Uploading the match video", text, minOf(1.0, finished.toDouble() / size)))
                    }
                }
            } finally {
                stream?.close()
            }
            val list = JSONArray((1..parts).map { JSONObject().put("n", it).put("etag", done.getString(it.toString())) })
            call("$apiBase/api/matches/$matchId/video/complete", JSONObject().put("key", key).put("uploadId", uploadId).put("size", size).put("parts", list), token)
            stateFile.delete()
            Notifications.done(applicationContext, notificationId, "Match video uploaded", "Your team can now watch it in Replays")
            Result.success()
        } catch (e: java.util.concurrent.CancellationException) {
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Stopped"))
        } catch (e: java.io.IOException) {
            // No connection or a dropped one: WorkManager tries again later, from the last finished part.
            Result.retry()
        } catch (e: Exception) {
            Notifications.done(applicationContext, notificationId, "Video upload failed", e.message ?: e.javaClass.simpleName)
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to (e.message ?: e.javaClass.simpleName)))
        }
    }

    private fun mb(b: Long) = "%.0f".format(b / 1048576.0)

    private fun describe(uri: Uri): Pair<Long, String> {
        if (uri.scheme == "file") File(uri.path!!).let { return it.length() to it.name }
        applicationContext.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE, OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) return c.getLong(0) to (c.getString(1) ?: "video.mp4")
        }
        return -1L to "video.mp4"
    }

    /** A JSON call to the VolleyIQ server. */
    private fun call(url: String, body: JSONObject, token: String?): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 15_000; readTimeout = 60_000
            setRequestProperty("Content-Type", "application/json")
            if (!token.isNullOrEmpty()) setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
            if (code >= 500 && code != 503) throw java.io.IOException("Server answered $code")
            if (code >= 400) throw IllegalStateException(runCatching { JSONObject(text).optString("error") }.getOrNull()?.takeIf { it.isNotBlank() } ?: "Server answered $code")
            return JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }

    /** One part straight to the bucket; returns its ETag. */
    private fun put(url: String, buf: ByteArray, len: Int): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"; doOutput = true; connectTimeout = 15_000; readTimeout = 120_000
            setFixedLengthStreamingMode(len)
        }
        try {
            conn.outputStream.use { it.write(buf, 0, len) }
            val code = conn.responseCode
            if (code !in 200..299) {
                val text = conn.errorStream?.bufferedReader()?.readText().orEmpty()
                if (code >= 500) throw java.io.IOException("Storage answered $code")
                throw IllegalStateException("Storage refused the upload ($code): ${text.take(120)}")
            }
            return conn.getHeaderField("ETag") ?: throw IllegalStateException("Storage sent no ETag")
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        const val KEY_MATCH = "matchId"
        const val KEY_URI = "uri"
    }
}
