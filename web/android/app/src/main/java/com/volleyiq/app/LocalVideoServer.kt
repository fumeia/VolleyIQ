package com.volleyiq.app

import android.content.Context
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * A tiny web server on the phone itself (127.0.0.1 only) for videos picked from the phone.
 *
 * The WebView plays these over a normal HTTP connection, like any video from the internet: its
 * media cache and read-ahead work as usual. Videos handed to the WebView through
 * shouldInterceptRequest (Capacitor's file URLs, [VideoServingClient]) go through a slow Java
 * stream bridge instead, and a 50 fps match stuttered even in slow motion.
 *
 * Other apps on the phone can reach 127.0.0.1 too, so every URL carries a random key that only
 * this app's WebView knows; requests without it get nothing.
 */
object LocalVideoServer {
    private val key: String = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private val pool = Executors.newCachedThreadPool { r -> Thread(r, "viq-video").apply { isDaemon = true } }
    @Volatile private var server: ServerSocket? = null
    private lateinit var app: Context

    /** The URL to play [uri] (content://, file:// or a path); starts the server when needed. */
    @Synchronized
    fun urlFor(context: Context, uri: String): String {
        app = context.applicationContext
        val s = server?.takeIf { !it.isClosed } ?: start()
        val u = if (uri.startsWith("/")) "file://$uri" else uri
        return "http://127.0.0.1:${s.localPort}/v/$key?u=${Uri.encode(u)}"
    }

    private fun start(): ServerSocket {
        val s = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        server = s
        pool.execute {
            try {
                while (!s.isClosed) {
                    val c = s.accept()
                    pool.execute { handle(c) }
                }
            } catch (_: Exception) {
                runCatching { s.close() }
            }
        }
        return s
    }

    private fun handle(socket: Socket) {
        socket.use { c ->
            c.soTimeout = 60_000
            c.tcpNoDelay = true
            val input = BufferedInputStream(c.getInputStream())
            val out = BufferedOutputStream(c.getOutputStream(), 64 * 1024)
            try {
                // Keep-alive: one request after the other on the same connection.
                while (true) {
                    val lines = readHead(input) ?: return
                    val (method, target) = lines[0].split(" ").let { if (it.size < 2) return else it[0] to it[1] }
                    val headers = lines.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
                    if (!serve(method, target, headers, out)) return
                }
            } catch (_: Exception) {
                // The player closed the connection (a seek, a new video): nothing to do.
            }
        }
    }

    /** The request line and headers, or null at the end of the connection. */
    private fun readHead(input: InputStream): List<String>? {
        val lines = mutableListOf<String>()
        val line = StringBuilder()
        var total = 0
        while (true) {
            val b = input.read()
            if (b < 0) return null
            if (++total > 16 * 1024) return null
            if (b == '\n'.code) {
                val l = line.toString().trimEnd('\r')
                line.clear()
                if (l.isEmpty()) { if (lines.isEmpty()) continue else return lines }
                lines += l
            } else line.append(b.toChar())
        }
    }

    /** Answers one request; false closes the connection. */
    private fun serve(method: String, target: String, headers: Map<String, String>, out: OutputStream): Boolean {
        if (method == "OPTIONS") {
            write(out, 204, "No Content", mapOf("Access-Control-Allow-Origin" to "*", "Access-Control-Allow-Headers" to "Range", "Content-Length" to "0"))
            return true
        }
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "")
        val u = query.split('&').firstOrNull { it.startsWith("u=") }?.let { URLDecoder.decode(it.substring(2), "UTF-8") }
        if (path != "/v/$key" || u == null || (method != "GET" && method != "HEAD")) {
            write(out, 404, "Not Found", mapOf("Content-Length" to "0"))
            return true
        }
        val source = Uri.parse(u)
        val pfd = runCatching { open(source) }.getOrNull()
        if (pfd == null) {
            write(out, 404, "Not Found", mapOf("Content-Length" to "0"))
            return true
        }
        pfd.use {
            FileInputStream(pfd.fileDescriptor).use { file ->
                val size = pfd.statSize
                val type = (if (source.scheme == "content") runCatching { app.contentResolver.getType(source) }.getOrNull() else null)
                    ?: when (source.path?.substringAfterLast('.')?.lowercase()) { "webm" -> "video/webm"; "mov" -> "video/quicktime"; else -> "video/mp4" }
                val base = mapOf("Content-Type" to type, "Accept-Ranges" to "bytes", "Access-Control-Allow-Origin" to "*", "Cache-Control" to "private, max-age=3600")
                val m = headers["range"]?.let { Regex("bytes=(\\d*)-(\\d*)").find(it) }
                var from = 0L
                var to = size - 1
                var status = 200
                if (m != null && size > 0) {
                    val (a, b) = m.destructured
                    if (a.isEmpty() && b.isNotEmpty()) from = (size - b.toLong()).coerceAtLeast(0)
                    else {
                        from = a.toLongOrNull() ?: 0L
                        to = b.toLongOrNull()?.coerceAtMost(size - 1) ?: (size - 1)
                    }
                    if (from >= size || from > to) {
                        write(out, 416, "Range Not Satisfiable", base + mapOf("Content-Range" to "bytes */$size", "Content-Length" to "0"))
                        return true
                    }
                    status = 206
                }
                val length = to - from + 1
                val h = base + mapOf("Content-Length" to length.toString()) +
                    (if (status == 206) mapOf("Content-Range" to "bytes $from-$to/$size") else emptyMap())
                write(out, status, if (status == 206) "Partial Content" else "OK", h)
                if (method == "HEAD") return true
                val channel = file.channel
                channel.position(from)
                val buf = ByteArray(256 * 1024)
                var left = length
                while (left > 0) {
                    val n = file.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (n <= 0) return false
                    out.write(buf, 0, n)
                    left -= n
                }
                out.flush()
            }
        }
        return true
    }

    private fun write(out: OutputStream, status: Int, reason: String, headers: Map<String, String>) {
        val sb = StringBuilder("HTTP/1.1 $status $reason\r\n")
        for ((k, v) in headers) sb.append(k).append(": ").append(v).append("\r\n")
        sb.append("Connection: keep-alive\r\n\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
        out.flush()
    }

    private fun open(source: Uri): ParcelFileDescriptor? {
        val path = source.path
        return when (source.scheme) {
            "content" -> app.contentResolver.openFileDescriptor(source, "r")
            "file", null -> if (path == null) null else ParcelFileDescriptor.open(File(path), ParcelFileDescriptor.MODE_READ_ONLY)
            else -> null
        }
    }
}
