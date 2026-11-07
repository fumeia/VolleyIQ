package com.volleyiq.app.analysis

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

data class Contact(val t: Double, val strength: Double)
data class Interval(val start: Double, val end: Double)

/** Contact / whistle / edit-cut detection (port of worker/volleyiq_worker/audio.py and video.py). */
object Detection {

    /** How far each moment's sound change stands out from its surroundings (robust z-score). */
    private fun zScore(flux: FloatArray): FloatArray {
        val win = (3 * AudioSpec.FPS).toInt() or 1
        val med = movingMedian(flux, win)
        val dev = FloatArray(flux.size) { abs(flux[it] - med[it]) }
        val mad = movingMedian(dev, win)
        return FloatArray(flux.size) { (flux[it] - med[it]) / max(mad[it], 0.02f * med[it] + 1e-6f) }
    }

    /** How much of a sound's energy stays after it (impulses fade fast; music, crowd and speech do not). */
    private fun sustain(flux: FloatArray, p: Int): Float {
        val a = p + 3
        val b = min(flux.size, p + 12)
        if (b <= a || flux[p] <= 0f) return 0f
        var s = 0f
        for (i in a until b) s += flux[i]
        return s / (b - a) / flux[p]
    }

    private fun peakTime(p: Int) = (p + AudioSpec.NFFT / 2.0 / AudioSpec.HOP) / AudioSpec.FPS

    /**
     * Ball contacts: sound peaks above [threshold] / [sensitivity] that fade fast enough
     * ([sustainMax]). Both numbers can be learned from tagged matches (see the server's tuning).
     */
    fun contacts(
        feat: AudioFeatures,
        sensitivity: Double = 1.0,
        minGap: Double = 0.35,
        whistles: List<Interval> = emptyList(),
        threshold: Double = DEFAULT_THRESHOLD,
        sustainMax: Double = DEFAULT_SUSTAIN,
    ): List<Contact> {
        val flux = feat.flux
        if (flux.size < 10) return emptyList()
        val z = zScore(flux)
        val thr = threshold / sensitivity
        val out = ArrayList<Contact>()
        for (p in findPeaks(z, thr.toFloat(), max(1, (minGap * AudioSpec.FPS).toInt()))) {
            val t = peakTime(p)
            if (whistles.any { t >= it.start - 0.15 && t <= it.end + 0.15 }) continue
            if (sustain(flux, p) > sustainMax) continue
            val strength = 1 - exp(-(z[p] - thr) / (2 * thr))
            out += Contact(t, strength.coerceIn(0.05, 1.0))
        }
        return out
    }

    /**
     * Every sound peak above a low floor, with measurements of it, kept with a run so the server can
     * learn from them against the tagged touches (thresholds, and the trained model in SoundModel):
     * [t, z, sustain, height, rise, width, tonality, band level, energy before, energy after].
     */
    fun candidates(feat: AudioFeatures, whistles: List<Interval>, floor: Float = 3f, minGap: Double = 0.35): List<DoubleArray> {
        val flux = feat.flux
        if (flux.size < 10) return emptyList()
        val z = zScore(flux)
        return findPeaks(z, floor, max(1, (minGap * AudioSpec.FPS).toInt())).mapNotNull { p ->
            val t = peakTime(p)
            if (whistles.any { t >= it.start - 0.15 && t <= it.end + 0.15 }) null
            else measure(feat, p, t, z[p], sustain(flux, p))
        }
    }

    private fun mean(x: FloatArray, from: Int, to: Int): Double {
        val a = max(0, from)
        val b = min(x.size - 1, to)
        if (b < a) return 0.0
        var s = 0.0
        for (i in a..b) s += x[i]
        return s / (b - a + 1)
    }

    private fun measure(feat: AudioFeatures, p: Int, t: Double, z: Float, sus: Float): DoubleArray {
        val flux = feat.flux
        val h = flux[p].toDouble()
        // How sharply it rises against just before, how many frames it stays above half its height.
        val rise = h / (mean(flux, p - 6, p - 2) + 1e-6)
        var l = p
        while (l > 0 && flux[l - 1] >= h / 2) l--
        var r = p
        while (r < flux.size - 1 && flux[r + 1] >= h / 2) r++
        val tonal = feat.tonality.getOrElse(p) { 0f }.toDouble()
        val band = if (p < feat.bandDb.size) feat.bandDb[p] - mean(feat.bandDb, p - 100, p + 100) else 0.0
        val pre = mean(flux, p - 30, p - 5) / (h + 1e-6)
        val post = mean(flux, p + 12, p + 40) / (h + 1e-6)
        return doubleArrayOf(t, z.toDouble(), sus.toDouble(), h, rise, (r - l + 1).toDouble(), tonal, band, pre, post)
    }

    const val DEFAULT_THRESHOLD = 8.0
    const val DEFAULT_SUSTAIN = 0.6

    fun whistles(feat: AudioFeatures, minLen: Double = 0.25): List<Interval> {
        val n = feat.tonality.size
        if (n == 0) return emptyList()
        val loudThr = percentile(feat.bandDb, 60.0) + 6
        val raw = BooleanArray(n) { feat.tonality[it] > 12 && feat.bandDb[it] > loudThr }
        // 5-frame majority vote closes small gaps (same as a 5-wide median on 0/1).
        val mask = BooleanArray(n) { i ->
            var c = 0
            for (j in i - 2..i + 2) if (raw[reflect(j, n)]) c++
            c >= 3
        }
        val runs = ArrayList<Interval>()
        var start = -1
        for (i in 0..n) {
            val on = i < n && mask[i]
            if (on && start < 0) start = i
            else if (!on && start >= 0) {
                if ((i - start) / AudioSpec.FPS >= minLen) runs += Interval(start / AudioSpec.FPS, i / AudioSpec.FPS)
                start = -1
            }
        }
        return runs
    }

    /** Edit cuts from frame differences sampled at [fps]: spikes far above the local motion level. */
    fun cuts(diffs: FloatArray, fps: Double, ratio: Float = 6f, minDiff: Float = 6f): List<Double> {
        if (diffs.size < 3) return emptyList()
        val med = movingMedian(diffs, 31)
        val out = ArrayList<Double>()
        for (i in diffs.indices) {
            if (diffs[i] > minDiff && diffs[i] / (med[i] + 0.3f) > ratio) {
                val t = (i + 1) / fps
                if (out.isEmpty() || t - out.last() > 1.0) out += t
            }
        }
        return out
    }

    /**
     * Local maxima above [height], thinned so that no two are closer than [distance]
     * (higher peaks win), like scipy.signal.find_peaks.
     */
    fun findPeaks(x: FloatArray, height: Float, distance: Int): List<Int> {
        val cands = ArrayList<Int>()
        var i = 1
        while (i < x.size - 1) {
            if (x[i] > x[i - 1]) {
                var j = i
                while (j + 1 < x.size && x[j + 1] == x[i]) j++ // plateau
                if (j + 1 < x.size && x[j + 1] < x[i] && x[i] >= height) cands += (i + j) / 2
                i = j + 1
            } else i++
        }
        val keep = BooleanArray(cands.size) { true }
        for (k in cands.indices.sortedByDescending { x[cands[it]] }) {
            if (!keep[k]) continue
            var l = k - 1
            while (l >= 0 && cands[k] - cands[l] < distance) keep[l--] = false
            var r = k + 1
            while (r < cands.size && cands[r] - cands[k] < distance) keep[r++] = false
        }
        return cands.filterIndexed { k, _ -> keep[k] }
    }

    /**
     * Sliding median with reflected edges. Exact medians are computed every few
     * samples and held in between, which is accurate for slowly varying levels
     * and keeps a two-hour match fast on a phone.
     */
    fun movingMedian(x: FloatArray, window: Int, stride: Int = max(1, window / 15)): FloatArray {
        val n = x.size
        val out = FloatArray(n)
        val half = window / 2
        val scratch = FloatArray(window)
        var c = 0
        while (c < n) {
            for (k in 0 until window) scratch[k] = x[reflect(c - half + k, n)]
            val m = quickSelect(scratch, window / 2)
            val from = max(0, c - stride / 2)
            val to = if (c + stride >= n) n else min(n, c + stride - stride / 2)
            for (i in from until to) out[i] = m
            c += stride
        }
        return out
    }

    fun percentile(x: FloatArray, p: Double): Float {
        if (x.isEmpty()) return 0f
        val s = x.copyOf().also { it.sort() }
        val pos = p / 100 * (s.size - 1)
        val lo = pos.toInt()
        val hi = min(s.size - 1, lo + 1)
        return (s[lo] + (s[hi] - s[lo]) * (pos - lo)).toFloat()
    }

    private fun reflect(i: Int, n: Int): Int {
        if (n == 1) return 0
        var j = i
        while (j < 0 || j >= n) j = if (j < 0) -j - 1 else 2 * n - j - 1
        return j
    }

    private fun quickSelect(a: FloatArray, k: Int): Float {
        var lo = 0
        var hi = a.size - 1
        while (lo < hi) {
            val pivot = a[(lo + hi) ushr 1]
            var i = lo
            var j = hi
            while (i <= j) {
                while (a[i] < pivot) i++
                while (a[j] > pivot) j--
                if (i <= j) {
                    val t = a[i]; a[i] = a[j]; a[j] = t
                    i++; j--
                }
            }
            if (k <= j) hi = j else if (k >= i) lo = i else return a[k]
        }
        return a[k]
    }
}
