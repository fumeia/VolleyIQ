package com.volleyiq.app.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.util.concurrent.CancellationException

/**
 * Reads a video once, front to back, with the hardware decoder and hands over
 * the frames at the requested times. Much faster than seeking to every touch
 * (each seek re-decodes from the previous keyframe); stretches with nothing to
 * look at are skipped by seeking ahead.
 */
object FrameSampler {

    /**
     * @param timesUs sorted target times; [onFrame] gets each target index with a frame at or just after it.
     *        The bitmap is only valid during the callback.
     * @param maxSide frames are downscaled (by an integer factor) to at most this many pixels on the long side.
     */
    fun sample(
        context: Context, uri: Uri, timesUs: LongArray, maxSide: Int,
        onFrame: (targets: IntRange, frame: Bitmap) -> Unit,
        onProgress: (Double) -> Unit, isStopped: () -> Boolean,
    ) {
        if (timesUs.isEmpty()) return
        val plan = FramePlan(timesUs)
        val ex = MediaExtractor()
        ex.setDataSource(context, uri, null)
        val track = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
            ?: run { ex.release(); throw IllegalStateException("No video track") }
        ex.selectTrack(track)
        val fmt = ex.getTrackFormat(track)
        val rotation = if (fmt.containsKey(MediaFormat.KEY_ROTATION)) fmt.getInteger(MediaFormat.KEY_ROTATION) else 0
        fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
        val codec = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(fmt, null, null, 0)
        codec.start()

        plan.seekFrom(0)?.let { ex.seekTo(it, MediaExtractor.SEEK_TO_PREVIOUS_SYNC) }
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        try {
            while (!plan.done) {
                if (isStopped()) throw CancellationException("Analysis cancelled")
                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val n = ex.readSampleData(codec.getInputBuffer(inIdx)!!, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIdx, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                val idx = codec.dequeueOutputBuffer(info, 10_000)
                if (idx < 0) continue
                val pts = info.presentationTimeUs
                val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                val targets = if (info.size > 0) plan.take(pts) else IntRange.EMPTY
                if (!targets.isEmpty()) {
                    val bmp = toBitmap(codec, idx, maxSide, rotation)
                    codec.releaseOutputBuffer(idx, false)
                    if (bmp != null) {
                        try { onFrame(targets, bmp) } finally { bmp.recycle() }
                    }
                    onProgress(plan.progress)
                } else {
                    codec.releaseOutputBuffer(idx, false)
                }
                if (eos) break
                // Nothing to look at for a while: jump ahead instead of decoding every frame.
                plan.seekFrom(pts)?.let { target ->
                    ex.seekTo(target, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
                    codec.flush()
                    inputDone = false
                }
            }
        } finally {
            codec.stop(); codec.release(); ex.release()
        }
    }

    private fun toBitmap(codec: MediaCodec, idx: Int, maxSide: Int, rotation: Int): Bitmap? {
        val image = codec.getOutputImage(idx) ?: return null
        image.use {
            val w = it.width
            val h = it.height
            val step = maxOf(1, (maxOf(w, h) + maxSide - 1) / maxSide)
            val (yp, up, vp) = Triple(it.planes[0], it.planes[1], it.planes[2])
            val px = Yuv.toArgb(w, h, step, yp.buffer, yp.rowStride, yp.pixelStride, up.buffer, vp.buffer, up.rowStride, up.pixelStride)
            val bmp = Bitmap.createBitmap(px, w / step, h / step, Bitmap.Config.ARGB_8888)
            if (rotation == 0) return bmp
            val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rotation.toFloat()) }, false)
            bmp.recycle()
            return rotated
        }
    }
}
