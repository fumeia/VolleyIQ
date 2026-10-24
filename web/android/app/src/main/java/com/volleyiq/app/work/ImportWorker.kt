package com.volleyiq.app.work

import android.content.Context
import android.os.Environment
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.volleyiq.app.importer.LinkResolver
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Downloads a shared video (WeTransfer, Google Drive, Dropbox, YouTube, Vimeo, …)
 * into the app's video folder, as a foreground job with a progress notification.
 */
class ImportWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val notificationId = 3000 + (id.hashCode() and 0xfff) * 2
    private var lastPct = -1

    override suspend fun getForegroundInfo() = Notifications.foreground(applicationContext, notificationId, "Importing video", "Starting…", null)

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val link = inputData.getString(KEY_URL) ?: return@withContext Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "No link"))
        setForeground(getForegroundInfo())
        try {
            val dir = videoDir(applicationContext)
            val file = when (val target = LinkResolver.resolve(link)) {
                is LinkResolver.Target.Direct -> LinkResolver.download(target.url, dir, ::bytes, ::isStopped)
                is LinkResolver.Target.WeTransfer -> {
                    report(0.0, "Asking WeTransfer for the file")
                    LinkResolver.download(LinkResolver.weTransferDirectLink(target), dir, ::bytes, ::isStopped)
                }
                is LinkResolver.Target.YtDlp -> ytDlp(target.url, dir)
            }
            Notifications.done(applicationContext, notificationId, "Video imported", file.name)
            Result.success(workDataOf(KEY_PATH to file.absolutePath, KEY_NAME to file.name))
        } catch (e: java.util.concurrent.CancellationException) {
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to "Cancelled"))
        } catch (e: Exception) {
            Notifications.done(applicationContext, notificationId, "Import failed", e.message ?: e.javaClass.simpleName)
            Result.failure(workDataOf(AnalysisWorker.KEY_ERROR to (e.message ?: e.javaClass.simpleName)))
        }
    }

    private fun ytDlp(url: String, dir: File): File {
        report(0.0, "Preparing downloader")
        val ytdl = YoutubeDL.getInstance()
        ytdl.init(applicationContext)
        FFmpeg.getInstance().init(applicationContext)
        // Sites change often; keep yt-dlp current (ignored when offline).
        runCatching { ytdl.updateYoutubeDL(applicationContext, YoutubeDL.UpdateChannel.STABLE) }

        val target = File(dir, "dl-${System.currentTimeMillis()}").apply { mkdirs() }
        val request = YoutubeDLRequest(url).apply {
            addOption("--no-playlist")
            addOption("-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b")
            addOption("--merge-output-format", "mp4")
            addOption("-o", "${target.absolutePath}/%(title).80s.%(ext)s")
        }
        ytdl.execute(request, id.toString()) { progress, _, _ -> report(progress / 100.0, "Downloading ${progress.toInt()}%") }
        val file = target.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.maxByOrNull { it.length() }
            ?: throw IllegalStateException("The downloader produced no video")
        val out = File(dir, LinkResolver.safeName(file.name))
        val final = if (file.renameTo(out)) out else file
        if (final.parentFile != target) target.deleteRecursively()
        return final
    }

    private fun bytes(done: Long, total: Long) {
        val mb = done / 1_000_000
        if (total > 0) report(done.toDouble() / total, "Downloading $mb / ${total / 1_000_000} MB") else report(-1.0, "Downloading $mb MB")
    }

    private fun report(fraction: Double, message: String) {
        val pct = (fraction * 100).toInt()
        if (pct == lastPct && fraction >= 0) return
        lastPct = pct
        setProgressAsync(workDataOf(AnalysisWorker.KEY_PROGRESS to fraction, AnalysisWorker.KEY_MESSAGE to message))
        setForegroundAsync(Notifications.foreground(applicationContext, notificationId, "Importing video", message, fraction.takeIf { it >= 0 }))
    }

    companion object {
        const val KEY_URL = "url"
        const val KEY_PATH = "path"
        const val KEY_NAME = "name"

        fun videoDir(context: Context): File =
            File(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: context.filesDir, "VolleyIQ").apply { mkdirs() }
    }
}
