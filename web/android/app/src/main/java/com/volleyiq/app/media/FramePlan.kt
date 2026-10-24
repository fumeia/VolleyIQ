package com.volleyiq.app.media

import java.nio.ByteBuffer

/**
 * Which decoded frames to keep while reading a video once, front to back.
 * Targets are sorted times (µs); each is served by the first frame at or after
 * it. Long stretches without targets are skipped by seeking instead of decoding.
 */
class FramePlan(private val targetsUs: LongArray, private val seekGapUs: Long = 6_000_000, private val prerollUs: Long = 1_000_000) {
    private var next = 0

    init {
        require(targetsUs.indices.drop(1).all { targetsUs[it] >= targetsUs[it - 1] }) { "targets must be sorted" }
    }

    val done get() = next >= targetsUs.size

    /** Position to seek to (µs) when the next target is far ahead of [ptsUs], else null. */
    fun seekFrom(ptsUs: Long): Long? {
        if (done) return null
        val t = targetsUs[next]
        return if (t - ptsUs > seekGapUs) maxOf(0, t - prerollUs) else null
    }

    /** Target indices this frame serves (empty when it is still before the next target). */
    fun take(ptsUs: Long): IntRange {
        val start = next
        while (next < targetsUs.size && targetsUs[next] <= ptsUs) next++
        return start until next
    }

    /** Fraction of targets served, for progress. */
    val progress get() = if (targetsUs.isEmpty()) 1.0 else next.toDouble() / targetsUs.size
}

/**
 * YUV_420_888 (any row/pixel strides, as MediaCodec delivers them) to ARGB,
 * sampling every [step]-th pixel to downscale on the fly. Plain Kotlin so it can be unit-tested.
 */
object Yuv {
    fun toArgb(
        width: Int, height: Int, step: Int,
        y: ByteBuffer, yRow: Int, yPix: Int,
        u: ByteBuffer, v: ByteBuffer, uvRow: Int, uvPix: Int,
    ): IntArray {
        val w = width / step
        val h = height / step
        val out = IntArray(w * h)
        for (j in 0 until h) {
            val sy = j * step
            for (i in 0 until w) {
                val sx = i * step
                val yy = (y.get(sy * yRow + sx * yPix).toInt() and 0xff) - 16
                val uvIndex = (sy / 2) * uvRow + (sx / 2) * uvPix
                val uu = (u.get(uvIndex).toInt() and 0xff) - 128
                val vv = (v.get(uvIndex).toInt() and 0xff) - 128
                val c = 1.164f * maxOf(0, yy)
                val r = (c + 1.596f * vv + 0.5f).toInt().coerceIn(0, 255)
                val g = (c - 0.392f * uu - 0.813f * vv + 0.5f).toInt().coerceIn(0, 255)
                val b = (c + 2.017f * uu + 0.5f).toInt().coerceIn(0, 255)
                out[j * w + i] = (0xff shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        return out
    }
}
