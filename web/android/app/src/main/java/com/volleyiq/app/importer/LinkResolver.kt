package com.volleyiq.app.importer

import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.CookieHandler
import java.net.CookieManager
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.util.zip.ZipInputStream

/**
 * Turns a shared link into something we can download to the phone.
 * - WeTransfer: asks WeTransfer's web API for the file's direct link (what the website's download button does)
 * - Google Drive / Dropbox: rewrites share links to their direct-download form
 * - direct video links: downloaded as they are
 * - everything else (YouTube, Vimeo, Facebook, Instagram, …): handed to yt-dlp
 */
object LinkResolver {

    sealed class Target {
        data class Direct(val url: String) : Target()
        data class WeTransfer(val transferId: String, val securityHash: String, val recipientId: String?) : Target()
        data class YtDlp(val url: String) : Target()
    }

    private val VIDEO_EXT = Regex("\\.(mp4|mov|m4v|webm|mkv|avi|mts|m2ts)$", RegexOption.IGNORE_CASE)
    const val USER_AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"

    /** Classifies a link without network access (except we.tl short links, which [resolve] expands first). */
    fun classify(link: String): Target {
        val uri = URI(link.trim())
        val host = uri.host?.lowercase()?.removePrefix("www.") ?: throw IllegalArgumentException("Not a link: $link")
        val path = uri.path ?: ""
        return when {
            host == "we.tl" -> throw IllegalArgumentException("Short we.tl links must be expanded first (use resolve)")
            host == "wetransfer.com" || host.endsWith(".wetransfer.com") -> {
                // /downloads/<transfer_id>/<security_hash> or /downloads/<transfer_id>/<recipient_id>/<security_hash>
                val parts = path.split('/').filter { it.isNotEmpty() }.dropWhile { it != "downloads" }.drop(1)
                when (parts.size) {
                    2 -> Target.WeTransfer(parts[0], parts[1], null)
                    3 -> Target.WeTransfer(parts[0], parts[2], parts[1])
                    else -> throw IllegalArgumentException("Unrecognised WeTransfer link")
                }
            }
            host == "drive.google.com" || host == "docs.google.com" -> {
                val id = Regex("/d/([\\w-]{10,})").find(path)?.groupValues?.get(1) ?: query(uri)["id"]
                    ?: throw IllegalArgumentException("Unrecognised Google Drive link")
                Target.Direct("https://drive.usercontent.google.com/download?id=$id&export=download&confirm=t")
            }
            host == "dropbox.com" || host.endsWith(".dropbox.com") -> {
                val q = query(uri).filterKeys { it != "dl" && it != "raw" } + ("dl" to "1")
                Target.Direct("https://www.dropbox.com$path?" + q.entries.joinToString("&") { "${it.key}=${it.value}" })
            }
            VIDEO_EXT.containsMatchIn(path) -> Target.Direct(link.trim())
            else -> Target.YtDlp(link.trim())
        }
    }

    /** Like [classify], but expands we.tl short links first. */
    fun resolve(link: String): Target {
        val host = runCatching { URI(link.trim()).host?.lowercase() }.getOrNull()
        if (host == "we.tl") return classify(finalUrl(link.trim()))
        return classify(link)
    }

    /** WeTransfer's web API returns a short-lived direct link for the transfer. */
    fun weTransferDirectLink(t: Target.WeTransfer): String {
        val cookies = CookieManager()
        val previous = CookieHandler.getDefault()
        CookieHandler.setDefault(cookies)
        try {
            val home = open("https://wetransfer.com/")
            val html = home.inputStream.bufferedReader().use { it.readText() }
            val csrf = Regex("name=\"csrf-token\" content=\"([^\"]+)\"").find(html)?.groupValues?.get(1)
            val body = JSONObject().put("intent", "entire_transfer").put("security_hash", t.securityHash)
            t.recipientId?.let { body.put("recipient_id", it) }
            val conn = open("https://wetransfer.com/api/v4/transfers/${t.transferId}/download") {
                requestMethod = "POST"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-Requested-With", "XMLHttpRequest")
                csrf?.let { setRequestProperty("X-CSRF-Token", it) }
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            if (conn.responseCode !in 200..299) {
                val reply = conn.errorStream?.bufferedReader()?.use { it.readText() }?.take(200).orEmpty()
                throw IOException(
                    when (conn.responseCode) {
                        404 -> "WeTransfer says this transfer does not exist or has expired"
                        403 -> "WeTransfer refused the download (password-protected or expired?)"
                        else -> "WeTransfer error HTTP ${conn.responseCode}: $reply"
                    },
                )
            }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            return json.optString("direct_link").ifEmpty { throw IOException("WeTransfer did not return a download link") }
        } finally {
            CookieHandler.setDefault(previous)
        }
    }

    /**
     * Downloads [url] into [dir]. Zip archives (WeTransfer sends one for multi-file
     * transfers) are unpacked and the largest video inside is kept.
     */
    fun download(url: String, dir: File, onProgress: (Long, Long) -> Unit, isStopped: () -> Boolean): File {
        dir.mkdirs()
        val conn = open(url)
        if (conn.responseCode !in 200..299) throw IOException("Download failed (HTTP ${conn.responseCode})")
        val type = conn.contentType.orEmpty()
        if (type.startsWith("text/html")) throw IOException("The link opened a web page instead of a video (is the file shared publicly?)")
        val total = conn.contentLengthLong
        val name = safeName(fileName(conn) ?: "video-${System.currentTimeMillis()}.mp4")
        val tmp = File(dir, "$name.part")
        conn.inputStream.use { input -> copy(input, tmp, total, onProgress, isStopped) }
        val isZip = tmp.inputStream().use { s -> ByteArray(4).also { s.read(it) } }.contentEquals(byteArrayOf(0x50, 0x4b, 0x03, 0x04))
        if (isZip) return unzipLargestVideo(tmp, dir).also { tmp.delete() }
        val out = uniqueFile(dir, if (VIDEO_EXT.containsMatchIn(name)) name else "$name.mp4")
        if (!tmp.renameTo(out)) throw IOException("Could not save the video")
        return out
    }

    private fun unzipLargestVideo(zip: File, dir: File): File {
        var best: File? = null
        ZipInputStream(zip.inputStream().buffered()).use { zin ->
            while (true) {
                val entry = zin.nextEntry ?: break
                if (entry.isDirectory || !VIDEO_EXT.containsMatchIn(entry.name)) continue
                val out = uniqueFile(dir, safeName(entry.name.substringAfterLast('/')))
                out.outputStream().use { zin.copyTo(it) }
                if (best == null || out.length() > best!!.length()) {
                    best?.delete()
                    best = out
                } else out.delete()
            }
        }
        return best ?: throw IOException("The archive contains no video file")
    }

    private fun copy(input: InputStream, out: File, total: Long, onProgress: (Long, Long) -> Unit, isStopped: () -> Boolean) {
        val buf = ByteArray(256 * 1024)
        var done = 0L
        var lastReport = 0L
        out.outputStream().use { o ->
            while (true) {
                if (isStopped()) {
                    out.delete()
                    throw java.util.concurrent.CancellationException("Download cancelled")
                }
                val n = input.read(buf)
                if (n < 0) break
                o.write(buf, 0, n)
                done += n
                if (done - lastReport > 1_000_000) {
                    onProgress(done, total)
                    lastReport = done
                }
            }
        }
        onProgress(done, total)
    }

    private fun open(url: String, setup: HttpURLConnection.() -> Unit = {}): HttpURLConnection {
        var current = url
        repeat(8) {
            val conn = (URL(current).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 60_000
                setRequestProperty("User-Agent", USER_AGENT)
                setup()
            }
            if (conn.requestMethod == "GET" && conn.responseCode in 300..399) {
                val loc = conn.getHeaderField("Location") ?: return conn
                current = URL(URL(current), loc).toString()
                conn.disconnect()
            } else return conn
        }
        throw IOException("Too many redirects")
    }

    private fun finalUrl(url: String): String {
        var current = url
        repeat(8) {
            // GET, not HEAD: some short-link services answer HEAD with an error.
            val conn = (URL(current).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 20_000
                readTimeout = 20_000
                setRequestProperty("User-Agent", USER_AGENT)
            }
            val loc = if (conn.responseCode in 300..399) conn.getHeaderField("Location") else null
            conn.disconnect()
            current = loc?.let { URL(URL(current), it).toString() } ?: return current
        }
        return current
    }

    private fun fileName(conn: HttpURLConnection): String? {
        val cd = conn.getHeaderField("Content-Disposition")
        if (cd != null) {
            Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(cd)?.let { return URLDecoder.decode(it.groupValues[1], "UTF-8") }
            Regex("filename=\"?([^\";]+)\"?", RegexOption.IGNORE_CASE).find(cd)?.let { return it.groupValues[1] }
        }
        return conn.url.path.substringAfterLast('/').takeIf { VIDEO_EXT.containsMatchIn(it) }
    }

    fun safeName(name: String) = name.replace(Regex("[^\\w.\\- ]+"), "_").trim().take(120).ifEmpty { "video.mp4" }

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name)
        var i = 1
        while (f.exists()) f = File(dir, name.replaceFirst(Regex("(\\.[^.]+)?$"), "-${i++}$1"))
        return f
    }

    private fun query(uri: URI): Map<String, String> =
        uri.rawQuery?.split('&')?.mapNotNull { kv -> kv.split('=', limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }?.toMap()
            ?: emptyMap()
}
