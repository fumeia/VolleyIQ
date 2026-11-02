package com.volleyiq.app.importer

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import java.util.Locale

/**
 * One full-resolution frame of a YouTube video, without downloading the match: yt-dlp fetches
 * one second of the video stream from [t] (cut exactly there), and its first frame is read.
 * Used to read shirt numbers and line-ups while tagging from the embedded player.
 */
object YoutubeFrame {
    @Volatile private var ready = false
    private val lock = Any()

    fun grab(context: Context, url: String, t: Double): Bitmap = synchronized(lock) {
        val ytdl = YoutubeDL.getInstance()
        if (!ready) {
            ytdl.init(context)
            FFmpeg.getInstance().init(context)
            ready = true
        }
        val dir = File(context.cacheDir, "yt-frame").apply { deleteRecursively(); mkdirs() }
        val start = maxOf(0.0, t)
        val request = YoutubeDLRequest(url).apply {
            addOption("--no-playlist")
            // Video only (no audio to merge), at most 1080p.
            addOption("-f", "bv*[height<=1080][ext=mp4]/bv*[height<=1080]/b[height<=1080]/b")
            addOption("--download-sections", String.format(Locale.US, "*%.2f-%.2f", start, start + 1.0))
            addOption("--force-keyframes-at-cuts")
            addOption("-o", "${dir.absolutePath}/frame.%(ext)s")
        }
        try {
            ytdl.execute(request)
        } catch (e: Exception) {
            // An old yt-dlp is the usual cause when YouTube changed: update once and try again.
            runCatching { ytdl.updateYoutubeDL(context, YoutubeDL.UpdateChannel.STABLE) }
            ytdl.execute(request)
        }
        val file = dir.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.maxByOrNull { it.length() }
            ?: throw IllegalStateException("YouTube sent no picture")
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(file.absolutePath)
            return r.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: throw IllegalStateException("The picture could not be read")
        } finally {
            r.release()
            dir.deleteRecursively()
        }
    }
}
