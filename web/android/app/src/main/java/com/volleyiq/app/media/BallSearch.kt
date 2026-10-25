package com.volleyiq.app.media

import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** Axis-aligned box in pixels. */
data class Box(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width get() = right - left
    val height get() = bottom - top
}

/**
 * Geometry for finding the ball, kept free of Android types so it can be unit-tested.
 *
 * The detector sees a downscaled frame (320 px), where a ball across the court is a
 * few pixels and never found. So when the full frame shows no ball, it is searched
 * again in a few zoomed tiles around the players, where it is several times larger.
 */
object BallSearch {

    /**
     * Up to [maxTiles] overlapping tiles covering the players (plus room above them for a
     * ball in the air), each at most about half the frame wide so the ball is zoomed in.
     */
    fun tiles(people: List<Box>, frameW: Int, frameH: Int, maxTiles: Int = 4): List<Box> {
        if (people.isEmpty()) return emptyList()
        val h = people.map { it.height }.sorted()[people.size / 2]
        val l = max(0f, people.minOf { it.left } - 0.5f * h)
        val r = min(frameW.toFloat(), people.maxOf { it.right } + 0.5f * h)
        val t = max(0f, people.minOf { it.top } - 1.0f * h)
        val b = min(frameH.toFloat(), people.maxOf { it.bottom } + 0.2f * h)
        if (r - l < 8 || b - t < 8) return emptyList()
        val tileW = frameW * 0.5f
        val tileH = frameH * 0.5f
        var cols = max(1, Math.ceil(((r - l) / tileW).toDouble()).toInt())
        var rows = max(1, Math.ceil(((b - t) / tileH).toDouble()).toInt())
        while (cols * rows > maxTiles) if (cols >= rows) cols-- else rows--
        val w = (r - l) / cols
        val hh = (b - t) / rows
        val pad = 0.1f * max(w, hh) // overlap, so a ball on a tile border is still whole in one tile
        val out = ArrayList<Box>()
        for (j in 0 until rows) for (i in 0 until cols) {
            out += Box(
                max(0f, l + i * w - pad), max(0f, t + j * hh - pad),
                min(frameW.toFloat(), l + (i + 1) * w + pad), min(frameH.toFloat(), t + (j + 1) * hh + pad),
            )
        }
        return out
    }

    /**
     * How close the ball is to the nearest player: 1 = touching their box, falling off
     * with the distance measured in player heights (so it means the same near and far).
     */
    fun closeness(ballX: Float, ballY: Float, people: List<Box>): Double {
        if (people.isEmpty()) return 0.0
        return people.maxOf { p ->
            val cx = min(max(ballX, p.left), p.right)
            val cy = min(max(ballY, p.top), p.bottom)
            exp(-hypot(ballX - cx, ballY - cy) / (0.5 * max(1f, p.height)))
        }
    }
}
