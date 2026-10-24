package com.volleyiq.app.analysis

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** In-place radix-2 FFT for a fixed power-of-two size; magnitudes of the real input's spectrum. */
class Fft(private val n: Int) {
    private val bits = Integer.numberOfTrailingZeros(n)
    private val rev = IntArray(n) { Integer.reverse(it) ushr (32 - bits) }
    private val cosT = DoubleArray(n / 2) { cos(2 * PI * it / n) }
    private val sinT = DoubleArray(n / 2) { -sin(2 * PI * it / n) }
    private val re = DoubleArray(n)
    private val im = DoubleArray(n)

    init {
        require(n > 1 && n and (n - 1) == 0) { "FFT size must be a power of two" }
    }

    /** Writes |X[k]| for k = 0..n/2 into [out] (size n/2 + 1). */
    fun magnitudes(input: FloatArray, out: FloatArray) {
        for (i in 0 until n) {
            re[rev[i]] = input[i].toDouble()
            im[rev[i]] = 0.0
        }
        var size = 2
        while (size <= n) {
            val half = size / 2
            val step = n / size
            var start = 0
            while (start < n) {
                var k = 0
                for (j in start until start + half) {
                    val l = j + half
                    val tr = re[l] * cosT[k] - im[l] * sinT[k]
                    val ti = re[l] * sinT[k] + im[l] * cosT[k]
                    re[l] = re[j] - tr
                    im[l] = im[j] - ti
                    re[j] += tr
                    im[j] += ti
                    k += step
                }
                start += size
            }
            size *= 2
        }
        for (k in 0..n / 2) out[k] = sqrt(re[k] * re[k] + im[k] * im[k]).toFloat()
    }
}
