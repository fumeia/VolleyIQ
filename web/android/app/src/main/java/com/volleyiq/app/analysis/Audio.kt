package com.volleyiq.app.analysis

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max

/**
 * Audio features for contact and whistle detection (port of worker/volleyiq_worker/audio.py).
 * Input is mono 16 kHz audio fed in chunks; features are produced every 10 ms.
 */
object AudioSpec {
    const val SR = 16000
    const val HOP = 160
    const val NFFT = 512
    const val FPS = SR.toDouble() / HOP
}

class AudioFeatures(val flux: FloatArray, val tonality: FloatArray, val bandDb: FloatArray, val duration: Double)

class FeatureExtractor {
    private val fft = Fft(AudioSpec.NFFT)
    private val window = FloatArray(AudioSpec.NFFT) { (0.5 - 0.5 * cos(2 * PI * it / (AudioSpec.NFFT - 1))).toFloat() }
    private val frame = FloatArray(AudioSpec.NFFT)
    private val mag = FloatArray(AudioSpec.NFFT / 2 + 1)
    private val onsetBins = binRange(1000.0, 6000.0)
    private val whistleBins = binRange(2000.0, 4500.0)
    private val prevLog = FloatArray(onsetBins.last - onsetBins.first + 1)
    private var hasPrev = false

    private var buf = FloatArray(AudioSpec.SR)
    private var bufLen = 0
    private var total = 0L

    private val flux = FloatList()
    private val tonality = FloatList()
    private val bandDb = FloatList()

    private fun binRange(lo: Double, hi: Double): IntRange {
        val df = AudioSpec.SR.toDouble() / AudioSpec.NFFT
        val first = (0..AudioSpec.NFFT / 2).first { it * df >= lo }
        val last = (0..AudioSpec.NFFT / 2).last { it * df <= hi }
        return first..last
    }

    fun feed(samples: FloatArray, count: Int = samples.size) {
        total += count
        if (bufLen + count > buf.size) buf = buf.copyOf(max(buf.size * 2, bufLen + count))
        System.arraycopy(samples, 0, buf, bufLen, count)
        bufLen += count
        var pos = 0
        while (pos + AudioSpec.NFFT <= bufLen) {
            processFrame(pos)
            pos += AudioSpec.HOP
        }
        System.arraycopy(buf, pos, buf, 0, bufLen - pos)
        bufLen -= pos
    }

    private fun processFrame(offset: Int) {
        for (i in 0 until AudioSpec.NFFT) frame[i] = buf[offset + i] * window[i]
        fft.magnitudes(frame, mag)

        var f = 0f
        for ((j, k) in onsetBins.withIndex()) {
            val lm = ln(1f + 100f * mag[k])
            if (hasPrev) f += max(0f, lm - prevLog[j])
            prevLog[j] = lm
        }
        hasPrev = true
        flux.add(f)

        var peak = 0f
        var sum = 0.0
        var sq = 0.0
        for (k in whistleBins) {
            val m = mag[k]
            if (m > peak) peak = m
            sum += m
            sq += m.toDouble() * m
        }
        val n = whistleBins.last - whistleBins.first + 1
        tonality.add((peak / (sum / n + 1e-9)).toFloat())
        bandDb.add((10 * log10(sq / n + 1e-12)).toFloat())
    }

    fun finish() = AudioFeatures(flux.toArray(), tonality.toArray(), bandDb.toArray(), total.toDouble() / AudioSpec.SR)
}

/**
 * Streaming box-filter resampler to 16 kHz. Averaging over each output period
 * is a crude low-pass, which is plenty for onset detection.
 */
class Resampler(inputRate: Int) {
    private val ratio = inputRate.toDouble() / AudioSpec.SR
    private var pending = FloatArray(8192)
    private var pendingLen = 0
    private var pos = 0.0
    private var out = FloatArray(4096)

    /** Returns the number of output samples written to [output()]. */
    fun process(input: FloatArray, count: Int): Int {
        if (pendingLen + count > pending.size) pending = pending.copyOf(max(pending.size * 2, pendingLen + count))
        System.arraycopy(input, 0, pending, pendingLen, count)
        pendingLen += count
        val maxOut = (pendingLen / ratio).toInt() + 2
        if (out.size < maxOut) out = FloatArray(maxOut)
        var n = 0
        while (pos + ratio <= pendingLen) {
            val a = pos.toInt()
            val b = max(a + 1, (pos + ratio).toInt())
            var s = 0f
            for (i in a until b) s += pending[i]
            out[n++] = s / (b - a)
            pos += ratio
        }
        val consumed = pos.toInt()
        System.arraycopy(pending, consumed, pending, 0, pendingLen - consumed)
        pendingLen -= consumed
        pos -= consumed
        return n
    }

    fun output(): FloatArray = out
}

class FloatList(capacity: Int = 1024) {
    private var data = FloatArray(capacity)
    var size = 0
        private set

    fun add(v: Float) {
        if (size == data.size) data = data.copyOf(data.size * 2)
        data[size++] = v
    }

    fun toArray(): FloatArray = data.copyOf(size)
}
