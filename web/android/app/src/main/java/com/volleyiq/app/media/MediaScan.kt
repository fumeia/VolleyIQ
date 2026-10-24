package com.volleyiq.app.media

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import com.volleyiq.app.analysis.AudioFeatures
import com.volleyiq.app.analysis.FeatureExtractor
import com.volleyiq.app.analysis.FloatList
import com.volleyiq.app.analysis.Resampler
import java.nio.ByteOrder
import java.util.concurrent.CancellationException
import kotlin.math.abs

/** Streams a video's audio or picture through MediaCodec (hardware decoders, no full decode in memory). */
object MediaScan {

    /** Audio -> mono 16 kHz -> contact/whistle features. */
    fun audioFeatures(context: Context, uri: Uri, onProgress: (Double) -> Unit, isStopped: () -> Boolean): AudioFeatures {
        val ex = MediaExtractor()
        ex.setDataSource(context, uri, null)
        val track = findTrack(ex, "audio/") ?: run {
            ex.release()
            throw IllegalStateException("This video has no sound track, so ball contacts cannot be detected")
        }
        ex.selectTrack(track)
        val fmt = ex.getTrackFormat(track)
        val durationUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 0L
        val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(fmt, null, null, 0)
        codec.start()

        var channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var pcmFloat = false
        var resampler = Resampler(rate)
        val features = FeatureExtractor()
        val info = MediaCodec.BufferInfo()
        var mono = FloatArray(4096)
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (isStopped()) throw CancellationException("Analysis cancelled")
                if (!inputDone) inputDone = feedInput(ex, codec)
                val idx = codec.dequeueOutputBuffer(info, 10_000)
                if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val of = codec.outputFormat
                    channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    val r = of.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    if (r != rate) { rate = r; resampler = Resampler(rate) }
                    pcmFloat = of.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                        of.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                } else if (idx >= 0) {
                    val buf = codec.getOutputBuffer(idx)!!.order(ByteOrder.nativeOrder())
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val frames = info.size / (if (pcmFloat) 4 else 2) / channels
                    if (mono.size < frames) mono = FloatArray(frames)
                    if (pcmFloat) {
                        val fb = buf.asFloatBuffer()
                        for (i in 0 until frames) { var s = 0f; repeat(channels) { s += fb.get() }; mono[i] = s / channels }
                    } else {
                        val sb = buf.asShortBuffer()
                        for (i in 0 until frames) { var s = 0f; repeat(channels) { s += sb.get() / 32768f }; mono[i] = s / channels }
                    }
                    codec.releaseOutputBuffer(idx, false)
                    val n = resampler.process(mono, frames)
                    features.feed(resampler.output(), n)
                    if (durationUs > 0) onProgress((info.presentationTimeUs.toDouble() / durationUs).coerceIn(0.0, 1.0))
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
        } finally {
            codec.stop(); codec.release(); ex.release()
        }
        return features.finish()
    }

    const val DIFF_FPS = 25.0
    private const val SW = 160
    private const val SH = 90

    /**
     * Mean absolute luma difference between consecutive tiny frames, on a constant
     * 25 fps grid (phones record variable frame rates). Used to find edit cuts.
     */
    fun frameDiffs(context: Context, uri: Uri, onProgress: (Double) -> Unit, isStopped: () -> Boolean): FloatArray {
        val ex = MediaExtractor()
        ex.setDataSource(context, uri, null)
        val track = findTrack(ex, "video/") ?: run { ex.release(); return FloatArray(0) }
        ex.selectTrack(track)
        val fmt = ex.getTrackFormat(track)
        val durationUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 0L
        fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
        val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(fmt, null, null, 0)
        codec.start()

        val diffs = FloatList(4096)
        var prev: FloatArray? = null
        var cur = FloatArray(SW * SH)
        var nextUs = 0L
        val stepUs = (1_000_000 / DIFF_FPS).toLong()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        try {
            while (!outputDone) {
                if (isStopped()) throw CancellationException("Analysis cancelled")
                if (!inputDone) inputDone = feedInput(ex, codec)
                val idx = codec.dequeueOutputBuffer(info, 10_000)
                if (idx < 0) continue
                if (info.size > 0 && info.presentationTimeUs >= nextUs) {
                    val sampled = sampleLuma(codec, idx, fmt, cur)
                    if (sampled) {
                        // This frame fills every grid slot it covers; repeated slots are "no change".
                        var first = true
                        while (info.presentationTimeUs >= nextUs) {
                            val p = prev
                            if (p != null) {
                                var s = 0f
                                if (first) for (i in cur.indices) s += abs(cur[i] - p[i])
                                diffs.add(s / cur.size)
                            }
                            first = false
                            nextUs += stepUs
                        }
                        val spare = prev ?: FloatArray(SW * SH)
                        prev = cur
                        cur = spare
                    }
                }
                codec.releaseOutputBuffer(idx, false)
                if (durationUs > 0) onProgress((info.presentationTimeUs.toDouble() / durationUs).coerceIn(0.0, 1.0))
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
            }
        } finally {
            codec.stop(); codec.release(); ex.release()
        }
        return diffs.toArray()
    }

    private fun sampleLuma(codec: MediaCodec, idx: Int, fmt: MediaFormat, out: FloatArray): Boolean {
        val image = codec.getOutputImage(idx)
        if (image != null) {
            image.use {
                val plane = it.planes[0]
                val buf = plane.buffer
                val w = it.width
                val h = it.height
                for (y in 0 until SH) {
                    val row = (y * h / SH) * plane.rowStride
                    for (x in 0 until SW) out[y * SW + x] = (buf.get(row + (x * w / SW) * plane.pixelStride).toInt() and 0xff).toFloat()
                }
            }
            return true
        }
        // Fallback: planar/semi-planar layouts both start with a full-resolution Y plane.
        val buf = codec.getOutputBuffer(idx) ?: return false
        val w = fmt.getInteger(MediaFormat.KEY_WIDTH)
        val h = fmt.getInteger(MediaFormat.KEY_HEIGHT)
        if (buf.remaining() < w * h) return false
        val base = buf.position()
        for (y in 0 until SH) for (x in 0 until SW) out[y * SW + x] = (buf.get(base + (y * h / SH) * w + x * w / SW).toInt() and 0xff).toFloat()
        return true
    }

    private fun findTrack(ex: MediaExtractor, prefix: String): Int? =
        (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith(prefix) == true }

    /** Queues one compressed sample; returns true once the end of the stream was queued. */
    private fun feedInput(ex: MediaExtractor, codec: MediaCodec): Boolean {
        val inIdx = codec.dequeueInputBuffer(10_000)
        if (inIdx < 0) return false
        val buf = codec.getInputBuffer(inIdx)!!
        val n = ex.readSampleData(buf, 0)
        return if (n < 0) {
            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            true
        } else {
            codec.queueInputBuffer(inIdx, 0, n, ex.sampleTime, 0)
            ex.advance()
            false
        }
    }
}
