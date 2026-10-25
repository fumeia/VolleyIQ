package com.volleyiq.app.analysis

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin
import kotlin.random.Random

class AnalysisTest {

    private fun synth(duration: Double, contacts: List<Double>, whistles: List<Pair<Double, Double>> = emptyList()): FloatArray {
        val sr = AudioSpec.SR
        val rnd = Random(0)
        val x = FloatArray((duration * sr).toInt()) { (rnd.nextDouble(-1.0, 1.0) * 0.005).toFloat() }
        for (t in contacts) {
            val i = (t * sr).toInt()
            val n = (0.012 * sr).toInt()
            for (k in 0 until n) x[i + k] += (rnd.nextDouble(-1.0, 1.0) * 0.8 * exp(-k / (0.003 * sr))).toFloat()
        }
        for ((a, b) in whistles) {
            val i = (a * sr).toInt()
            for (k in 0 until ((b - a) * sr).toInt()) x[i + k] += (0.2 * sin(2 * PI * 3200 * k / sr)).toFloat()
        }
        return x
    }

    private fun features(x: FloatArray, chunk: Int = 7 * AudioSpec.SR): AudioFeatures {
        val ex = FeatureExtractor()
        var i = 0
        while (i < x.size) {
            val n = minOf(chunk, x.size - i)
            ex.feed(x.copyOfRange(i, i + n), n)
            i += n
        }
        return ex.finish()
    }

    @Test
    fun findsContactsAndWhistles() {
        val contacts = listOf(2.0, 3.4, 4.6, 5.5, 6.3, 20.0, 21.2, 22.5)
        val feat = features(synth(30.0, contacts, listOf(1.0 to 1.5, 9.0 to 9.6)))
        val wh = Detection.whistles(feat)
        assertEquals(2, wh.size)
        assertTrue(abs(wh[0].start - 1.0) < 0.1)
        val found = Detection.contacts(feat, whistles = wh).map { it.t }
        for (t in contacts) assertTrue("missing $t in $found", found.any { abs(it - t) < 0.05 })
        assertEquals(found.toString(), contacts.size, found.size)
    }

    @Test
    fun resamplerKeepsTiming() {
        val r = Resampler(48000)
        val input = FloatArray(48000) { if (it == 24000) 1f else 0f }
        val n = r.process(input, input.size)
        assertTrue(n in 15998..16000)
        val peak = (0 until n).maxByOrNull { r.output()[it] }!!
        assertTrue(abs(peak - 8000) <= 1)
    }

    @Test
    fun segmentsAtCutsAndDropsSpliceClicks() {
        val c = listOf(1.0, 2.2, 3.1, 5.0, 5.9, 6.8).map { Contact(it, 1.0) }
        val rallies = Rallies.segment(c, cuts = listOf(5.0 + 0.05, 4.5))
        assertEquals(2, rallies.size)
        assertEquals(listOf(5.9, 6.8), rallies[1].touches.map { it.t })
    }

    @Test
    fun labelsAndTeamsFromCourtSide() {
        val r = Rallies.segment(listOf(0.0, 1.2, 2.3, 3.1, 3.6).map { Contact(it, 1.0) })[0]
        Rallies.label(r)
        assertEquals(listOf("serve", "receive", "set", "attack", "dig"), r.touches.map { it.action })
        // We play on the near half and the serve came from deep on the near side.
        r.touches[0].pos = P(7.0, -1.0)
        r.touches[1].pos = P(4.0, 15.0)
        Rallies.assignTeams(r, emptySet(), "near")
        assertEquals(listOf("us", "them", "them", "them", "us"), r.touches.map { it.team })
        r.touches[4].pos = P(2.0, 3.0)
        val ev = Rallies.toEvents(listOf(r), "near")
        assertEquals(listOf("serve", "dig"), ev.map { it["action"] })
        assertEquals(4.0, ev[0]["x"]) // serve landed where they received it
        assertEquals(15.0, ev[0]["y"])
        assertEquals(listOf(7.0, -1.0), listOf(ev[0]["fx"], ev[0]["fy"])) // served from where the server stood
    }

    @Test
    fun homographyMapsCorners() {
        val img = listOf(P(0.2, 0.9), P(0.85, 0.92), P(0.7, 0.3), P(0.3, 0.29))
        val h = assertNotNullAndGet(Homography.fromCorners(img))
        for ((i, c) in Homography.COURT_CORNERS.withIndex()) {
            val p = h.toCourt(img[i].x, img[i].y)
            assertEquals(c.x, p.x, 1e-6)
            assertEquals(c.y, p.y, 1e-6)
        }
    }

    @Test
    fun homographyFromLandmarksWithoutCorners() {
        // Camera that sees the net ends and the near 3 m line, but not the near corners.
        val truth = assertNotNullAndGet(Homography.fromCorners(listOf(P(-0.3, 1.4), P(1.3, 1.4), P(0.75, 0.25), P(0.25, 0.25))))
        // Build image positions of 6 landmarks by inverting numerically: search the image point mapping to each court point.
        val court = listOf(P(0.0, 9.0), P(9.0, 9.0), P(0.0, 6.0), P(9.0, 6.0), P(0.0, 12.0), P(9.0, 12.0))
        val image = court.map { c -> invert(truth, c) }
        val fit = assertNotNullAndGet(Homography.fromPoints(image, court))
        val corner = fit.toCourt(invert(truth, P(0.0, 0.0)).x, invert(truth, P(0.0, 0.0)).y)
        assertEquals(0.0, corner.x, 1e-3)
        assertEquals(0.0, corner.y, 1e-3)
        val mid = fit.toCourt(invert(truth, P(4.5, 3.0)).x, invert(truth, P(4.5, 3.0)).y)
        assertEquals(4.5, mid.x, 1e-3)
        assertEquals(3.0, mid.y, 1e-3)
    }

    /** Newton iteration: image point that [h] maps to court point [c]. */
    private fun invert(h: Homography, c: P): P {
        var u = 0.5
        var v = 0.5
        repeat(50) {
            val p = h.toCourt(u, v)
            val e = 1e-6
            val pu = h.toCourt(u + e, v)
            val pv = h.toCourt(u, v + e)
            val a = (pu.x - p.x) / e; val b = (pv.x - p.x) / e
            val cc = (pu.y - p.y) / e; val d = (pv.y - p.y) / e
            val det = a * d - b * cc
            val dx = c.x - p.x
            val dy = c.y - p.y
            u += (d * dx - b * dy) / det
            v += (-cc * dx + a * dy) / det
        }
        return P(u, v)
    }

    private fun <T> assertNotNullAndGet(v: T?): T {
        assertNotNull(v)
        return v!!
    }

    /** Optional: run on a real match (16 kHz mono f32le dump) when VIQ_AUDIO is set. */
    @Test
    fun realMatchIfProvided() {
        val path = System.getenv("VIQ_AUDIO") ?: return
        val bytes = File(path).readBytes()
        val fb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
        val x = FloatArray(fb.remaining()).also { fb.get(it) }
        val feat = features(x)
        val wh = Detection.whistles(feat)
        val contacts = Detection.contacts(feat, whistles = wh)
        println("REAL whistles=${wh.size} contacts=${contacts.size}: " + contacts.joinToString(" ") { "%.2f".format(it.t) })
    }
}
