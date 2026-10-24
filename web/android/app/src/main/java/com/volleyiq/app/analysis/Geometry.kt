package com.volleyiq.app.analysis

import kotlin.math.abs

data class P(val x: Double, val y: Double)

/**
 * Maps normalized image coordinates (0..1) to court meters using the four
 * court corners the user tapped on a video frame. Court frame as the camera
 * sees it: x 0..9 from left to right, y 0 at the near baseline, 18 at the far one.
 */
class Homography private constructor(private val h: DoubleArray) {

    fun toCourt(u: Double, v: Double): P {
        val w = h[6] * u + h[7] * v + 1.0
        return P((h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w)
    }

    companion object {
        /** Corners in tap order: near-left, near-right, far-right, far-left. */
        val COURT_CORNERS = listOf(P(0.0, 0.0), P(9.0, 0.0), P(9.0, 18.0), P(0.0, 18.0))

        fun fromCorners(image: List<P>): Homography? {
            if (image.size != 4) return null
            // Solve the 8 unknowns of H (h33 = 1) from the 4 correspondences.
            val a = Array(8) { DoubleArray(9) }
            for (i in 0 until 4) {
                val (u, v) = image[i]
                val (x, y) = COURT_CORNERS[i]
                a[2 * i] = doubleArrayOf(u, v, 1.0, 0.0, 0.0, 0.0, -u * x, -v * x, x)
                a[2 * i + 1] = doubleArrayOf(0.0, 0.0, 0.0, u, v, 1.0, -u * y, -v * y, y)
            }
            return solve(a)?.let { Homography(it) }
        }

        private fun solve(a: Array<DoubleArray>): DoubleArray? {
            val n = 8
            for (col in 0 until n) {
                val pivot = (col until n).maxByOrNull { abs(a[it][col]) }!!
                if (abs(a[pivot][col]) < 1e-12) return null
                val t = a[col]; a[col] = a[pivot]; a[pivot] = t
                for (r in 0 until n) {
                    if (r == col) continue
                    val f = a[r][col] / a[col][col]
                    for (c in col..n) a[r][c] -= f * a[col][c]
                }
            }
            return DoubleArray(n) { a[it][n] / a[it][it] }
        }
    }
}
