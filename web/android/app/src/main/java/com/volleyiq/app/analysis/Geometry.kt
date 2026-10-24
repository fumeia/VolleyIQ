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

        fun fromCorners(image: List<P>): Homography? = fromPoints(image, COURT_CORNERS)

        /**
         * Least-squares fit from 4+ tapped landmarks (image -> court). Any known court
         * points work (net ends, 3 m lines, corners), so the corners need not be in view.
         */
        fun fromPoints(image: List<P>, court: List<P>): Homography? {
            if (image.size < 4 || image.size != court.size) return null
            // Normal equations (A^T A) h = A^T b, with h33 = 1.
            val ata = Array(8) { DoubleArray(9) }
            fun add(row: DoubleArray, b: Double) {
                for (i in 0 until 8) {
                    ata[i][8] += row[i] * b
                    for (j in 0 until 8) ata[i][j] += row[i] * row[j]
                }
            }
            for (k in image.indices) {
                val (u, v) = image[k]
                val (x, y) = court[k]
                add(doubleArrayOf(u, v, 1.0, 0.0, 0.0, 0.0, -u * x, -v * x), x)
                add(doubleArrayOf(0.0, 0.0, 0.0, u, v, 1.0, -u * y, -v * y), y)
            }
            return solve(ata)?.let { Homography(it) }
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
