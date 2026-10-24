package com.volleyiq.app.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.RectF
import com.google.android.gms.tasks.Tasks
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.volleyiq.app.analysis.Homography
import com.volleyiq.app.analysis.P
import java.io.Closeable
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Looks at frames around each ball contact: finds the player closest to the
 * ball (on-device object detector), places them on the court when the video
 * is calibrated, and reads their jersey number (on-device OCR). Frames are
 * handed in by [FrameSampler]; evidence per touch is gathered in an [Evidence].
 */
class TouchVision(context: Context, private val readJerseys: Boolean, private val homography: Homography?) : Closeable {

    data class Result(val jersey: Int?, val jerseyConf: Double, val pos: P?)

    /** Votes and position collected over the frames of one touch. */
    class Evidence {
        internal val votes = HashMap<Int, Double>()
        internal var pos: P? = null
        internal var frames = 0
    }

    private val detector: ObjectDetector = ObjectDetector.createFromOptions(
        context,
        ObjectDetector.ObjectDetectorOptions.builder()
            .setBaseOptions(BaseOptions.builder().setModelAssetPath("models/efficientdet_lite0.tflite").build())
            .setRunningMode(RunningMode.IMAGE)
            .setScoreThreshold(0.2f)
            .setMaxResults(40)
            .setCategoryAllowlist(listOf("person", "sports ball"))
            .build(),
    )
    private val ocr: TextRecognizer? = if (readJerseys) TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) else null

    fun look(frame: Bitmap, roster: Set<Int>, ev: Evidence) {
        ev.frames++
        val dets = detector.detect(BitmapImageBuilder(frame).build()).detections()
        val people = dets.filter { it.categories().firstOrNull()?.categoryName() == "person" }.map { it.boundingBox() }
        if (people.isEmpty()) return
        val ball = dets.filter { it.categories().firstOrNull()?.categoryName() == "sports ball" }
            .maxByOrNull { it.categories()[0].score() }?.boundingBox()
        val candidates = if (ball != null) {
            people.sortedBy { distance(ball.centerX(), ball.centerY(), it) }.take(2)
        } else {
            // No ball found: the closest (largest) players are the best guess for OCR only.
            people.sortedByDescending { it.width() * it.height() }.take(2)
        }
        if (ball != null && ev.pos == null && homography != null) {
            val feet = candidates[0]
            ev.pos = homography.toCourt((feet.centerX() / frame.width).toDouble(), (feet.bottom / frame.height).toDouble())
        }
        if (ocr != null) {
            val weight = if (ball != null) doubleArrayOf(1.0, 0.5) else doubleArrayOf(0.5, 0.25)
            candidates.forEachIndexed { i, box ->
                for (n in readNumbers(frame, box)) ev.votes[n] = (ev.votes[n] ?: 0.0) + weight[i] * (if (n in roster) 1.3 else 1.0)
            }
        }
    }

    fun result(ev: Evidence): Result {
        val best = ev.votes.maxByOrNull { it.value }
        return Result(best?.key, min(1.0, (best?.value ?: 0.0) / maxOf(1, ev.frames)), ev.pos)
    }

    /** OCR on the torso (where the number is printed, front or back). */
    private fun readNumbers(frame: Bitmap, box: RectF): List<Int> {
        val h = box.height()
        val left = box.left.toInt().coerceIn(0, frame.width - 1)
        val top = (box.top + 0.12f * h).toInt().coerceIn(0, frame.height - 1)
        val right = box.right.toInt().coerceIn(left + 1, frame.width)
        val bottom = (box.top + 0.6f * h).toInt().coerceIn(top + 1, frame.height)
        if (right - left < 10 || bottom - top < 16) return emptyList()
        var crop = Bitmap.createBitmap(frame, left, top, right - left, bottom - top)
        if (crop.height < 96) {
            val f = 96f / crop.height
            crop = Bitmap.createScaledBitmap(crop, (crop.width * f).toInt(), 96, true)
        }
        return try {
            val text = Tasks.await(ocr!!.process(InputImage.fromBitmap(crop, 0)))
            text.textBlocks.flatMap { b -> b.lines.flatMap { l -> l.elements } }
                .mapNotNull { e -> e.text.takeIf { Regex("\\d{1,2}").matches(it) }?.toInt() }
                .filter { it in 1..99 }
        } catch (e: Exception) {
            emptyList()
        } finally {
            crop.recycle()
        }
    }

    private fun distance(x: Float, y: Float, b: RectF): Float {
        val cx = min(max(x, b.left), b.right)
        val cy = min(max(y, b.top), b.bottom)
        return hypot(x - cx, y - cy)
    }

    override fun close() {
        detector.close()
        ocr?.close()
    }

    companion object {
        /** Seconds around the contact: the toucher is next to the ball just before it. */
        val OFFSETS = doubleArrayOf(-0.16, 0.04)
    }
}
