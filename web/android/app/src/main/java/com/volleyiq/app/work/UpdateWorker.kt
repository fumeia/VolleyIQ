package com.volleyiq.app.work

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Downloads an app update (through the VolleyIQ server) as a foreground job, so it goes on
 * when you switch to another app. The notification shows the progress and about how long it
 * still takes; when done, tapping it opens Android's installer.
 */
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val notificationId = 5000

    override suspend fun getForegroundInfo() = Notifications.foreground(applicationContext, notificationId, "Downloading the update", "Starting…", null)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString(KEY_URL) ?: return@withContext Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "No address"))
        val token = inputData.getString(KEY_TOKEN)
        setForeground(getForegroundInfo())
        try {
            val file = apkFile(applicationContext)
            file.parentFile?.listFiles()?.forEach { it.delete() }
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 60_000
                if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
            }
            if (conn.responseCode != 200) throw IllegalStateException("Server answered ${conn.responseCode}")
            val total = conn.contentLengthLong
            val start = System.currentTimeMillis()
            var done = 0L
            var lastReport = 0L
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (isStopped) throw java.util.concurrent.CancellationException()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val now = System.currentTimeMillis()
                        if (now - lastReport > 500) {
                            lastReport = now
                            report(done, total, now - start)
                        }
                    }
                }
            }
            if (total > 0 && done != total) throw IllegalStateException("Download incomplete, try again")
            ready(file)
            Result.success(workDataOf(KEY_PATH to file.absolutePath))
        } catch (e: java.util.concurrent.CancellationException) {
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Cancelled"))
        } catch (e: Exception) {
            Notifications.done(applicationContext, notificationId, "Update download failed", e.message ?: e.javaClass.simpleName)
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to (e.message ?: e.javaClass.simpleName)))
        }
    }

    private suspend fun report(done: Long, total: Long, elapsedMs: Long) {
        val mb = { b: Long -> "%.1f".format(b / 1048576.0) }
        val text = if (total > 0) {
            val speed = done / (elapsedMs / 1000.0).coerceAtLeast(0.5)
            "${mb(done)} of ${mb(total)} MB · ${left((total - done) / speed.coerceAtLeast(1.0))}"
        } else "${mb(done)} MB"
        setProgress(workDataOf(KEY_DONE to done, KEY_TOTAL to total))
        setForeground(Notifications.foreground(applicationContext, notificationId, "Downloading the update", text, if (total > 0) done.toDouble() / total else null))
    }

    /** Download finished: a notification that opens the installer when tapped. */
    private fun ready(file: File) {
        val install = installIntent(applicationContext, file)
        val n = Notifications.builder(applicationContext, "Update downloaded", "Tap to install", null, ongoing = false)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(applicationContext, 1, install, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        applicationContext.getSystemService(NotificationManager::class.java).notify(notificationId + 1, n)
    }

    companion object {
        const val KEY_URL = "url"
        const val KEY_TOKEN = "token"
        const val KEY_PATH = "path"
        const val KEY_DONE = "done"
        const val KEY_TOTAL = "total"

        fun apkFile(context: Context) = File(File(context.cacheDir, "updates").apply { mkdirs() }, "VolleyIQ-update.apk")

        fun installIntent(context: Context, file: File): Intent {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            return Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }

        /** "about 2 min left", rounded so it does not jump around. */
        fun left(seconds: Double): String = when {
            seconds < 10 -> "a few seconds left"
            seconds < 60 -> "about ${((seconds / 10).toInt() + 1) * 10} s left"
            seconds < 3600 -> "about ${(seconds / 60).toInt() + 1} min left"
            else -> "about ${(seconds / 3600).toInt()} h ${((seconds % 3600) / 60).toInt()} min left"
        }
    }
}
