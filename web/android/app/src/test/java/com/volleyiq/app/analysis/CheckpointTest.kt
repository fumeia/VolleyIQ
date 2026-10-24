package com.volleyiq.app.analysis

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class CheckpointTest {
    private fun tempRoot(): File = Files.createTempDirectory("viq-cp").toFile()

    @Test
    fun savesAndRestoresEveryStage() {
        val root = tempRoot()
        val store = CheckpointStore(root, "content://video/1|123456")
        val feat = AudioFeatures(floatArrayOf(1f, 2f), floatArrayOf(3f, 4f), floatArrayOf(-5f, -6f), 12.5)
        store.saveFeatures(feat)
        store.saveDiffs(floatArrayOf(0.5f, 9f))
        val vision = mapOf(
            CheckpointStore.touchKey(1.234) to VisionResult(7, 0.8, P(3.0, 12.0)),
            CheckpointStore.touchKey(2.0) to VisionResult(null, 0.0, null),
        )
        store.saveVision("jerseys=true|cal=abc", vision)

        // A new process (after an app update) sees the same data.
        val again = CheckpointStore(root, "content://video/1|123456")
        val f = again.loadFeatures()!!
        assertEquals(12.5, f.duration, 0.0)
        assertTrue(f.flux.contentEquals(feat.flux) && f.bandDb.contentEquals(feat.bandDb))
        assertTrue(again.loadDiffs()!!.contentEquals(floatArrayOf(0.5f, 9f)))
        assertEquals(vision, again.loadVision("jerseys=true|cal=abc"))
        // Other settings start a fresh vision pass; other videos have no checkpoints.
        assertTrue(again.loadVision("jerseys=false|cal=").isEmpty())
        assertEquals(null, CheckpointStore(root, "content://video/2|99").loadFeatures())
    }

    @Test
    fun corruptFilesAreIgnored() {
        val root = tempRoot()
        val store = CheckpointStore(root, "v")
        store.saveDiffs(floatArrayOf(1f, 2f, 3f))
        val file = root.listFiles()!!.first().resolve("diffs.bin")
        file.writeBytes(file.readBytes().copyOf(10)) // truncated, as if killed mid-write without the temp-file swap
        assertEquals(null, store.loadDiffs())
    }

    @Test
    fun pruneKeepsRecentVideos() {
        val root = tempRoot()
        for (i in 1..5) {
            CheckpointStore(root, "video-$i").saveDiffs(floatArrayOf(i.toFloat()))
            Thread.sleep(15) // distinct "last used" times
        }
        CheckpointStore.prune(root, keep = 3)
        assertEquals(3, root.listFiles()!!.size)
        assertTrue(CheckpointStore(root, "video-5").loadDiffs() != null)
    }
}
