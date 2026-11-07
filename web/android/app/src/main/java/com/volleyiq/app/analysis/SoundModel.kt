package com.volleyiq.app.analysis

import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min

/**
 * The touch model trained on the server from the tagged matches (server/src/model.js): a logistic
 * regression over measurements of each sound peak and its rhythm. A peak is a touch when the model's
 * chance is at least [cut]; the sensitivity slider moves that line.
 */
class SoundModel(private val mean: DoubleArray, private val std: DoubleArray, private val w: DoubleArray, private val b: Double, val cut: Double) {

    fun chance(x: DoubleArray): Double {
        var z = b
        for (k in w.indices) z += w[k] * ((x[k] - mean[k]) / std[k])
        return 1 / (1 + exp(-z))
    }

    /**
     * Touches among the run's peaks ([Detection.candidates], sorted by time). A higher sensitivity
     * lowers the line (in log-odds, so it moves the same way at every level).
     */
    fun contacts(peaks: List<DoubleArray>, sensitivity: Double = 1.0): List<Contact> {
        if (peaks.isEmpty() || peaks[0].size < 10) return emptyList()
        val logit = ln(cut / (1 - cut)) - 2 * ln(max(sensitivity, 0.1))
        val line = 1 / (1 + exp(-logit))
        val x = features(peaks)
        return peaks.indices.mapNotNull { i ->
            val c = chance(x[i])
            if (c >= line) Contact(peaks[i][0], c.coerceIn(0.05, 1.0)) else null
        }
    }

    companion object {
        const val N_FEATURES = 13

        /** The model as the server sends it (JSON), or null when there is none or it does not fit. */
        fun parse(json: String?): SoundModel? = runCatching {
            if (json.isNullOrBlank()) return null
            val o = JSONObject(json)
            fun arr(k: String) = o.getJSONArray(k).let { a -> DoubleArray(a.length()) { a.getDouble(it) } }
            val w = arr("w")
            if (w.size != N_FEATURES || o.optInt("features", N_FEATURES) != N_FEATURES) return null
            SoundModel(arr("mean"), arr("std").map { if (it > 1e-6) it else 1.0 }.toDoubleArray(), w, o.getDouble("b"), o.getDouble("cut"))
        }.getOrNull()

        private fun clamp(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))

        /** The model's inputs per peak: exactly as features() in server/src/model.js. */
        fun features(peaks: List<DoubleArray>): List<DoubleArray> {
            val n = peaks.size
            val lz = DoubleArray(n) { ln(max(peaks[it][1], 1.0)) }
            val sum = DoubleArray(n + 1)
            for (i in 0 until n) sum[i + 1] = sum[i] + lz[i]
            var a3 = 0; var b3 = 0; var a10 = 0; var b10 = 0
            return List(n) { i ->
                val p = peaks[i]
                val t = p[0]
                while (peaks[a3][0] < t - 3) a3++
                if (b3 < i) b3 = i
                while (b3 + 1 < n && peaks[b3 + 1][0] <= t + 3) b3++
                while (peaks[a10][0] < t - 10) a10++
                if (b10 < i) b10 = i
                while (b10 + 1 < n && peaks[b10 + 1][0] <= t + 10) b10++
                val prev = if (i > 0) min(t - peaks[i - 1][0], 3.0) else 3.0
                val next = if (i + 1 < n) min(peaks[i + 1][0] - t, 3.0) else 3.0
                doubleArrayOf(
                    lz[i],
                    min(p[2], 3.0),
                    ln(1 + max(p[3], 0.0)),
                    clamp(ln(max(p[4], 0.01)), -5.0, 5.0),
                    min(p[5], 30.0) / 10,
                    clamp(ln(max(p[6], 0.01)), -5.0, 5.0),
                    clamp(p[7], -40.0, 40.0) / 10,
                    min(p[8], 5.0),
                    min(p[9], 5.0),
                    prev,
                    next,
                    (b3 - a3) / 10.0,
                    lz[i] - (sum[b10 + 1] - sum[a10]) / (b10 - a10 + 1),
                )
            }
        }
    }
}
