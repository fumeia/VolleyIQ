package com.volleyiq.app.analysis

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.MessageDigest

/** What the vision pass found for one touch. */
data class VisionResult(val jersey: Int?, val jerseyConf: Double, val pos: P?)

/**
 * Saved progress of an analysis, so a job that Android stops (app update,
 * reboot, low memory) resumes instead of starting over. One folder per video:
 *
 *  - features.bin  audio features (the slow decode); independent of the sensitivity setting
 *  - diffs.bin     frame differences for edit-cut detection
 *  - vision-<variant>.bin  per-touch player results, appended in batches; the variant
 *    covers settings that change them (jersey reading on/off, calibration)
 *
 * Every write goes to a temp file that is then renamed, so a kill mid-write
 * never leaves a corrupt checkpoint. Only the most recent videos are kept.
 */
class CheckpointStore(root: File, videoKey: String) {
    private val dir = File(root, sha1(videoKey).take(16))

    init {
        dir.mkdirs()
        dir.setLastModified(System.currentTimeMillis())
    }

    fun loadFeatures(): AudioFeatures? = read("features.bin") { s ->
        val duration = s.readDouble()
        AudioFeatures(readFloats(s), readFloats(s), readFloats(s), duration)
    }

    fun saveFeatures(f: AudioFeatures) = write("features.bin") { s ->
        s.writeDouble(f.duration)
        writeFloats(s, f.flux); writeFloats(s, f.tonality); writeFloats(s, f.bandDb)
    }

    fun loadDiffs(): FloatArray? = read("diffs.bin") { readFloats(it) }

    fun saveDiffs(d: FloatArray) = write("diffs.bin") { writeFloats(it, d) }

    fun loadVision(variant: String): MutableMap<Long, VisionResult> =
        read("vision-${sha1(variant).take(12)}.bin") { s ->
            val n = s.readInt()
            val out = HashMap<Long, VisionResult>(n * 2)
            repeat(n) {
                val key = s.readLong()
                val jersey = s.readInt().takeIf { it >= 0 }
                val conf = s.readDouble()
                val pos = if (s.readBoolean()) P(s.readDouble(), s.readDouble()) else null
                out[key] = VisionResult(jersey, conf, pos)
            }
            out
        } ?: HashMap()

    fun saveVision(variant: String, results: Map<Long, VisionResult>) = write("vision-${sha1(variant).take(12)}.bin") { s ->
        s.writeInt(results.size)
        for ((key, r) in results) {
            s.writeLong(key)
            s.writeInt(r.jersey ?: -1)
            s.writeDouble(r.jerseyConf)
            s.writeBoolean(r.pos != null)
            r.pos?.let { s.writeDouble(it.x); s.writeDouble(it.y) }
        }
    }

    private fun <T> read(name: String, f: (DataInputStream) -> T): T? {
        val file = File(dir, name)
        if (!file.exists()) return null
        return try {
            DataInputStream(file.inputStream().buffered()).use { s ->
                if (s.readInt() != MAGIC) return null
                f(s)
            }
        } catch (e: Exception) {
            file.delete() // unreadable (older format, truncated): recompute
            null
        }
    }

    private fun write(name: String, f: (DataOutputStream) -> Unit) {
        val tmp = File(dir, "$name.tmp")
        DataOutputStream(tmp.outputStream().buffered()).use { s ->
            s.writeInt(MAGIC)
            f(s)
        }
        val target = File(dir, name)
        if (!tmp.renameTo(target)) {
            target.delete()
            tmp.renameTo(target)
        }
    }

    companion object {
        private const val MAGIC = 0x56495131 // "VIQ1"

        /** Stable key of a touch time, in milliseconds. */
        fun touchKey(t: Double) = Math.round(t * 1000)

        /** Keeps the checkpoints of the [keep] most recently used videos. */
        fun prune(root: File, keep: Int = 3) {
            root.listFiles()?.filter { it.isDirectory }?.sortedByDescending { it.lastModified() }?.drop(keep)?.forEach { it.deleteRecursively() }
        }

        private fun writeFloats(s: DataOutputStream, a: FloatArray) {
            s.writeInt(a.size)
            for (v in a) s.writeFloat(v)
        }

        private fun readFloats(s: DataInputStream): FloatArray {
            val n = s.readInt()
            require(n in 0..50_000_000) { "bad length" }
            return FloatArray(n) { s.readFloat() }
        }

        fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
