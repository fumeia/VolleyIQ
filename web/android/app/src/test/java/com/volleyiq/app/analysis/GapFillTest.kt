package com.volleyiq.app.analysis

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class GapFillTest {

    private fun rally(vararg t: Double) = Rally(t.map { Touch(it, 0.8) }.toMutableList())

    @Test
    fun guessesMissingTouchesFromTheRhythm() {
        // Serve, then the far-side receive and set are not heard before their attack at 3.6 s.
        val r = rally(0.0, 3.6, 4.7)
        Rallies.fillGaps(r, emptyList())
        assertEquals(listOf(Rallies.HEARD, Rallies.GAP, Rallies.GAP, Rallies.HEARD, Rallies.HEARD), r.touches.map { it.kind })
        assertTrue(abs(r.touches[1].t - 1.2) < 1e-9)
        Rallies.label(r)
        assertEquals(listOf("serve", "receive", "set", "attack", "dig"), r.touches.map { it.action })
    }

    @Test
    fun snapsToAQuietSoundAndLeavesNormalGapsAlone() {
        val r = rally(0.0, 1.1, 3.5)
        val quiet = Rallies.quietContacts(listOf(Contact(0.0, 1.0), Contact(1.1, 1.0)), listOf(Contact(1.15, 0.2), Contact(2.5, 0.1), Contact(2.2, 0.3)))
        assertEquals(listOf(2.5, 2.2), quiet.map { it.t }) // 1.15 is the heard touch again
        Rallies.fillGaps(r, quiet)
        assertEquals(listOf(0.0, 1.1, 2.2, 3.5), r.touches.map { it.t }) // strongest quiet sound near the expected 2.3 s
        assertEquals(Rallies.QUIET, r.touches[2].kind)
    }

    @Test
    fun visionDropsServeBouncesAndQuietSoundsAwayFromTheBall() {
        val r = rally(0.0, 1.0, 2.2, 3.3)
        r.touches[0].pos = P(6.0, -1.0) // bounce behind the near baseline
        r.touches[1].pos = P(6.2, -1.1) // the serve, same spot
        r.touches[2].pos = P(3.0, 14.0)
        r.touches.add(3, Touch(2.8, 0.1, kind = Rallies.QUIET).also { it.ball = 0.02 })
        Rallies.applyVision(r)
        assertEquals(listOf(1.0, 2.2, 3.3), r.touches.map { it.t })
    }

    @Test
    fun ballAtThePlayerOutweighsLoudness() {
        val clap = Touch(0.0, 1.0).also { it.ball = 0.0; it.action = "dig" }
        val quietTouch = Touch(1.0, 0.1).also { it.ball = 1.0; it.action = "dig" }
        assertTrue(Rallies.confidence(clap) < 0.4)
        assertTrue(Rallies.confidence(quietTouch) > 0.6)
        assertTrue(Rallies.confidence(Touch(2.0, 0.5).also { it.action = "set" }).let { it > 0.4 && it < 0.6 }) // no ball seen: sound only
    }

    @Test
    fun hintsReachTheEvents() {
        val r = rally(0.0, 3.6, 4.7)
        Rallies.fillGaps(r, emptyList())
        Rallies.label(r)
        val ev = Rallies.toEvents(listOf(r), null)
        assertEquals(listOf(null, "gap", "gap", null, null), ev.map { it["hint"] })
    }

    @Test
    fun labelsPossessionsByCourtSide() {
        // Serve from behind our baseline, they pass and attack in two touches (no set),
        // we dig and set, then an overpass by them goes straight back.
        val r = rally(0.0, 1.2, 2.0, 3.0, 3.8, 4.9)
        val ys = listOf(-1.0, 14.0, 12.5, 4.0, 6.5, 13.0)
        r.touches.forEachIndexed { i, t -> t.pos = P(4.0, ys[i]) }
        Rallies.label(r)
        assertEquals(listOf("serve", "receive", "set", "dig", "set", "dig"), r.touches.map { it.action })
        assertEquals(listOf(0, 1, 1, 2, 2, 3), r.touches.map { it.possession })
    }

    @Test
    fun countsTouchesWithoutPositions() {
        val r = rally(0.0, 1.0, 2.0, 3.0, 4.0)
        Rallies.label(r)
        assertEquals(listOf("serve", "receive", "set", "attack", "dig"), r.touches.map { it.action })
    }

    @Test
    fun aTouchAtTheNetAfterAnAttackIsABlock() {
        val r = rally(0.0, 1.2, 2.0, 2.8, 3.0, 3.9)
        val ys = listOf(-1.0, 14.0, 12.5, 11.5, 9.3, 4.0)
        r.touches.forEachIndexed { i, t -> t.pos = P(4.0, ys[i]) }
        Rallies.label(r)
        assertEquals(listOf("serve", "receive", "set", "attack", "block_touch", "dig"), r.touches.map { it.action })
        assertEquals(listOf(0, 1, 1, 1, 2, 2), r.touches.map { it.possession })
    }
}
