package com.volleyiq.app

import android.net.Uri
import android.os.ParcelFileDescriptor
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/**
 * Plays a video from the phone in the WebView with proper byte ranges.
 *
 * Capacitor's own file URLs (convertFileSrc) answer a range request with the file from its very
 * first byte, whatever range was asked for, so the video element has to read the whole file up
 * to the playing position again for every piece: the deeper into a long match, the more the
 * picture stutters. Here "/_viq_video/?u=<content:// or file uri>" is served from exactly the
 * requested byte (a seek on the file), in pieces of at most [CHUNK] bytes.
 *
 * The WebView moves to the start of a range itself, by calling skip() on the stream it gets
 * (Chromium's InputStreamReader), so the stream starts at byte 0 and its skip() is a seek.
 */
class VideoServingClient(bridge: Bridge) : BridgeWebViewClient(bridge) {
    private val context = bridge.context

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (url.path?.startsWith(PREFIX) != true) return super.shouldInterceptRequest(view, request)
        return try {
            serve(request, Uri.parse(url.getQueryParameter("u") ?: return notFound()))
        } catch (e: Exception) {
            notFound()
        }
    }

    private fun serve(request: WebResourceRequest, source: Uri): WebResourceResponse {
        val pfd = open(source) ?: return notFound()
        val size = pfd.statSize
        val type = (if (source.scheme == "content") context.contentResolver.getType(source) else null) ?: "video/mp4"
        val input = FileInputStream(pfd.fileDescriptor)
        val range = (request.requestHeaders["Range"] ?: request.requestHeaders["range"])
            ?.let { Regex("bytes=(\\d*)-(\\d*)").find(it) }
        val headers = mutableMapOf("Accept-Ranges" to "bytes", "Cache-Control" to "no-store")
        if (range == null || size <= 0) {
            if (size > 0) headers["Content-Length"] = size.toString()
            return WebResourceResponse(type, null, 200, "OK", headers, Seeking(input, pfd, 0, if (size > 0) size else Long.MAX_VALUE))
        }
        val (a, b) = range.destructured
        var from = a.toLongOrNull() ?: 0L
        var to = b.toLongOrNull() ?: (size - 1)
        if (a.isEmpty() && b.isNotEmpty()) { from = (size - b.toLong()).coerceAtLeast(0); to = size - 1 }
        if (from >= size) {
            input.close(); pfd.close()
            headers["Content-Range"] = "bytes */$size"
            return WebResourceResponse(type, null, 416, "Range Not Satisfiable", headers, null)
        }
        to = minOf(to, size - 1, from + CHUNK - 1)
        val length = to - from + 1
        headers["Content-Range"] = "bytes $from-$to/$size"
        headers["Content-Length"] = length.toString()
        return WebResourceResponse(type, null, 206, "Partial Content", headers, Seeking(input, pfd, from, to + 1))
    }

    private fun open(source: Uri): ParcelFileDescriptor? {
        val path = source.path
        return when (source.scheme) {
            "content" -> context.contentResolver.openFileDescriptor(source, "r")
            "file", null -> if (path == null) null else ParcelFileDescriptor.open(File(path), ParcelFileDescriptor.MODE_READ_ONLY)
            else -> null
        }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)

    /**
     * The file from byte 0 up to [end]: skip() jumps (no reading through), reads stop at [end].
     * available() says 0, so the WebView skips to the range start and reads to the end. Should a
     * WebView read without skipping first, the stream starts at [from] instead.
     */
    private class Seeking(private val input: FileInputStream, private val pfd: ParcelFileDescriptor, private val from: Long, private val end: Long) : InputStream() {
        private val channel = input.channel
        private var moved = false
        private fun pos(): Long {
            if (!moved) { moved = true; if (from > 0) channel.position(from) }
            return channel.position()
        }
        override fun available() = 0
        override fun skip(n: Long): Long {
            if (n <= 0) return 0
            moved = true
            val at = channel.position()
            val to = minOf(at + n, end)
            channel.position(to)
            return to - at
        }
        override fun read(): Int {
            if (pos() >= end) return -1
            return input.read()
        }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            val left = end - pos()
            if (left <= 0) return -1
            return input.read(b, off, minOf(len.toLong(), left).toInt())
        }
        override fun close() {
            runCatching { input.close() }
            runCatching { pfd.close() }
        }
    }

    companion object {
        const val PREFIX = "/_viq_video/"
        /** At most this much per answer: the video element asks for the next piece itself. */
        const val CHUNK = 4L * 1024 * 1024
    }
}
