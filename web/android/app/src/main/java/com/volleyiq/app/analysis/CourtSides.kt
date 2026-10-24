package com.volleyiq.app.analysis

import org.json.JSONArray

/**
 * The court calibration per stretch of the video. Teams switch sides every set,
 * so from each side switch on "our half" flips; the court marking carries over
 * unless it was marked again (camera moved).
 */
class CourtSides(private val from: DoubleArray, private val homographies: List<Homography?>, private val halves: List<String?>) {

    val hasCourt get() = homographies.any { it != null }

    private fun index(t: Double): Int {
        var i = 0
        while (i + 1 < from.size && from[i + 1] <= t) i++
        return i
    }

    fun homography(t: Double) = homographies[index(t)]
    fun ourHalf(t: Double) = halves[index(t)]

    /** Set number at [t], when side switches were marked (one per set); else unknown. */
    fun setNo(t: Double): Int? = if (from.size > 1) index(t) + 1 else null

    companion object {
        fun single(h: Homography?, ourHalf: String?) = CourtSides(doubleArrayOf(0.0), listOf(h), listOf(ourHalf))

        /** From the app's JSON: [{from, ourHalf, points: [u, v, x, y, ...]}, ...]. Null when missing or invalid. */
        fun parse(json: String?): CourtSides? {
            if (json.isNullOrBlank()) return null
            return runCatching {
                val a = JSONArray(json)
                val segs = (0 until a.length()).map { a.getJSONObject(it) }.sortedBy { it.optDouble("from", 0.0) }
                if (segs.isEmpty()) return null
                CourtSides(
                    DoubleArray(segs.size) { segs[it].optDouble("from", 0.0) },
                    segs.map { s ->
                        val p = s.optJSONArray("points") ?: return@map null
                        val v = DoubleArray(p.length()) { p.getDouble(it) }
                        if (v.size < 16 || v.size % 4 != 0) return@map null
                        val n = v.size / 4
                        Homography.fromPoints((0 until n).map { P(v[4 * it], v[4 * it + 1]) }, (0 until n).map { P(v[4 * it + 2], v[4 * it + 3]) })
                    },
                    segs.map { s -> s.optString("ourHalf").takeIf { it == "near" || it == "far" } },
                )
            }.getOrNull()
        }
    }
}
