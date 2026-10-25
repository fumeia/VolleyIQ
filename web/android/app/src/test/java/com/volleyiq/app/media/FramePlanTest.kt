package com.volleyiq.app.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer

class FramePlanTest {
    @Test
    fun servesEachTargetWithTheFirstFrameAtOrAfterIt() {
        val plan = FramePlan(longArrayOf(1_000_000, 1_000_000, 1_030_000, 20_000_000))
        assertEquals(null, plan.seekFrom(0)) // first target is close: just decode
        assertTrue(plan.take(980_000).isEmpty())
        assertEquals(0 until 2, plan.take(1_010_000)) // two touches share a frame
        assertEquals(2 until 3, plan.take(1_040_000))
        // 19 s to the next target: seek to 1 s before it instead of decoding everything
        assertEquals(19_000_000L, plan.seekFrom(1_040_000))
        assertTrue(plan.take(19_500_000).isEmpty())
        assertEquals(3 until 4, plan.take(20_010_000))
        assertTrue(plan.done)
    }

    @Test
    fun convertsYuvToRgb() {
        // 4x2 image, planar U/V at half resolution; pure white, black and a red-ish chroma
        val y = ByteBuffer.wrap(byteArrayOf(235.toByte(), 235.toByte(), 16, 16, 235.toByte(), 235.toByte(), 16, 16))
        val u = ByteBuffer.wrap(byteArrayOf(128.toByte(), 90))
        val v = ByteBuffer.wrap(byteArrayOf(128.toByte(), 240.toByte()))
        val px = Yuv.toArgb(4, 2, 1, y, 4, 1, u, v, 2, 1)
        assertEquals(0xffffffff.toInt(), px[0])
        val r = (px[2] shr 16) and 0xff
        val b = px[2] and 0xff
        assertTrue("red channel should dominate: r=$r b=$b", r > 150 && b < 40)
        // step 2 halves both dimensions
        assertEquals(2, Yuv.toArgb(4, 2, 2, y, 4, 1, u, v, 2, 1).size)
    }
}
