package com.volleyiq.app.importer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkResolverTest {
    @Test
    fun weTransferLinks() {
        assertEquals(
            LinkResolver.Target.WeTransfer("abc123", "hash456", null),
            LinkResolver.classify("https://wetransfer.com/downloads/abc123/hash456?t_exp=1&t_lsid=x"),
        )
        assertEquals(
            LinkResolver.Target.WeTransfer("abc123", "hash456", "rcpt"),
            LinkResolver.classify("https://wetransfer.com/downloads/abc123/rcpt/hash456"),
        )
    }

    @Test
    fun driveAndDropboxBecomeDirectDownloads() {
        assertEquals(
            LinkResolver.Target.Direct("https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMn&export=download&confirm=t"),
            LinkResolver.classify("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing"),
        )
        val dbx = LinkResolver.classify("https://www.dropbox.com/scl/fi/xyz/match.mp4?rlkey=k1&dl=0") as LinkResolver.Target.Direct
        assertTrue(dbx.url, dbx.url.contains("dl=1") && dbx.url.contains("rlkey=k1") && !dbx.url.contains("dl=0"))
    }

    @Test
    fun directVideosAndEverythingElse() {
        assertEquals(LinkResolver.Target.Direct("https://example.com/a/match.MP4"), LinkResolver.classify("https://example.com/a/match.MP4"))
        assertEquals(LinkResolver.Target.YtDlp("https://youtu.be/dQw4w9WgXcQ"), LinkResolver.classify("https://youtu.be/dQw4w9WgXcQ"))
        assertEquals(LinkResolver.Target.YtDlp("https://vimeo.com/12345"), LinkResolver.classify("https://vimeo.com/12345"))
    }

    @Test
    fun safeNames() {
        assertEquals("Turnier_ Rheinfelden.mp4", LinkResolver.safeName("Turnier/ Rheinfelden.mp4"))
    }
}
