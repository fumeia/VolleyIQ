package com.volleyiq.app.analysis

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round

/**
 * Rally segmentation and touch labelling (port of worker/volleyiq_worker/rallies.py).
 *
 * Model: serve, then possessions of up to three touches (first touch, set,
 * attack) alternating between the teams. Everything produced here is only a
 * suggestion; the coach confirms or fixes it in the review pass.
 */
class Touch(
    val t: Double,
    val strength: Double,
    var action: String = "attack",
    var possession: Int = 0,
    var jersey: Int? = null,
    var jerseyConf: Double = 0.0,
    /** Where the touching player stood, in court meters as the camera sees it (near baseline y = 0). */
    var pos: P? = null,
    var team: String? = null, // "us" | "them" | null
    /** How it was found: [Rallies.HEARD], [Rallies.QUIET] (faint sound in a gap) or [Rallies.GAP] (guessed from the rhythm). */
    val kind: String = Rallies.HEARD,
    /** 1 = ball right at the touching player in the frames, 0 = ball seen far from everyone, null = ball not seen. */
    var ball: Double? = null,
)

class Rally(val touches: MutableList<Touch>)

object Rallies {
    const val MAX_GAP = 3.5
    const val MIN_CONTACTS = 2
    const val CUT_GUARD = 0.15

    const val HEARD = "heard"
    const val QUIET = "quiet"
    const val GAP = "gap"

    /** Default time between two touches of a rally, when the match has too few to measure it. */
    const val TOUCH_INTERVAL = 1.2
    /** Gaps shorter than this are never filled (a serve or a high free ball takes that long). */
    const val MIN_FILL_GAP = 1.6
    /** Quiet sounds count from this much more sensitive a detector, but only where a touch is missing. */
    const val QUIET_BOOST = 2.0
    private const val MIN_SPACING = 0.3
    private const val SNAP = 0.45

    /** Quiet contacts: heard only by a more sensitive detector, away from the normal ones. */
    fun quietContacts(normal: List<Contact>, sensitive: List<Contact>): List<Contact> =
        sensitive.filter { q -> normal.none { abs(it.t - q.t) < MIN_SPACING } }

    /**
     * Far-side touches are often too faint to hear, which leaves holes in the rally
     * rhythm. Where the gap between two heard touches is long enough to hide one or
     * two touches, adds them: at a quiet sound in the expected spot if there is one,
     * otherwise as a guess at the expected time. Both are marked, so the review can
     * tell them apart from clearly heard touches.
     */
    /** The match's own rhythm: median time between consecutive heard touches of a rally. */
    fun typicalInterval(rallies: List<Rally>): Double {
        val d = rallies.flatMap { r -> r.touches.zipWithNext { a, b -> b.t - a.t } }.filter { it in 0.3..2.5 }.sorted()
        return if (d.size < 10) TOUCH_INTERVAL else d[d.size / 2].coerceIn(0.8, 1.3)
    }

    fun fillGaps(rally: Rally, quiet: List<Contact>, interval: Double = TOUCH_INTERVAL) {
        val src = rally.touches
        val out = ArrayList<Touch>(src.size)
        for (i in src.indices) {
            out += src[i]
            val next = src.getOrNull(i + 1) ?: break
            val gap = next.t - src[i].t
            val missing = if (gap < MIN_FILL_GAP) 0 else (round(gap / interval).toInt() - 1).coerceIn(0, 2)
            for (k in 1..missing) {
                val ideal = src[i].t + gap * k / (missing + 1)
                val after = out.last().t + MIN_SPACING
                val q = quiet.filter { abs(it.t - ideal) < SNAP && it.t > after && it.t < next.t - MIN_SPACING }.maxByOrNull { it.strength }
                when {
                    q != null -> out += Touch(q.t, q.strength, kind = QUIET)
                    ideal > after && ideal < next.t - MIN_SPACING -> out += Touch(ideal, 0.0, kind = GAP)
                }
            }
        }
        src.clear()
        src.addAll(out)
    }

    /**
     * Uses what the camera saw: the bounces of the server before the serve (two
     * touches in a row behind the same baseline) are dropped, and so are quiet
     * sounds where the ball was clearly somewhere else.
     */
    fun applyVision(rally: Rally) {
        val ts = rally.touches
        fun behind(t: Touch) = t.pos?.let { if (it.y < -0.3) -1 else if (it.y > 18.3) 1 else 0 } ?: 0
        while (true) {
            val heard = ts.filter { it.kind == HEARD }
            if (heard.size < 3) break
            val (bounce, serve) = heard
            if (behind(bounce) == 0 || behind(bounce) != behind(serve) || serve.t - bounce.t >= 2.5) break
            ts.removeAll { it.t < serve.t } // the bounce, and anything guessed between it and the serve
        }
        ts.removeAll { it.kind == QUIET && (it.ball ?: 1.0) < 0.15 }
    }

    fun segment(contacts: List<Contact>, whistles: List<Interval> = emptyList(), cuts: List<Double> = emptyList()): List<Rally> {
        // The audio splice at an edit cut sounds like a contact.
        val kept = contacts.filter { c -> cuts.none { kotlin.math.abs(c.t - it) < CUT_GUARD } }.sortedBy { it.t }
        val boundaries = (whistles.map { it.start } + cuts).sorted()
        val rallies = ArrayList<Rally>()
        var cur = ArrayList<Touch>()
        var bi = 0
        for (c in kept) {
            var crossed = false
            while (bi < boundaries.size && boundaries[bi] < c.t) {
                if (cur.isNotEmpty() && boundaries[bi] > cur.last().t) crossed = true
                bi++
            }
            if (cur.isNotEmpty() && (c.t - cur.last().t > MAX_GAP || crossed)) {
                rallies += Rally(cur)
                cur = ArrayList()
            }
            cur += Touch(c.t, c.strength)
        }
        if (cur.isNotEmpty()) rallies += Rally(cur)
        return rallies.filter { it.touches.size >= MIN_CONTACTS }
    }

    fun label(rally: Rally) {
        val touches = rally.touches
        touches[0].action = "serve"
        touches[0].possession = 0
        var possession = 1
        var k = 0
        for (touch in touches.drop(1)) {
            if (k == 3) { // max three touches per side
                possession++
                k = 0
            }
            touch.action = when (k) {
                0 -> if (possession == 1) "receive" else "dig"
                1 -> "set"
                else -> "attack"
            }
            touch.possession = possession
            k++
        }
    }

    /**
     * Decides which possessions are ours. Evidence: jersey numbers on/off our
     * roster, and which half the touching player stood on. Possessions alternate,
     * so every read votes on "the serving side is us".
     */
    fun assignTeams(rally: Rally, roster: Set<Int>, ourHalf: String?) {
        var score = 0.0
        for (t in rally.touches) {
            val parity = if (t.possession % 2 == 0) 1.0 else -1.0
            val jersey = t.jersey
            if (jersey != null && t.jerseyConf >= 0.4) score += (if (jersey in roster) 1.0 else -1.0) * parity * t.jerseyConf
            val pos = t.pos
            if (pos != null && ourHalf != null && pos.y in -3.0..21.0) {
                val near = pos.y < 9.0
                val ours = (ourHalf == "near") == near
                // Players near the net may reach over; trust deep positions more.
                val w = min(1.0, kotlin.math.abs(pos.y - 9.0) / 3.0) * 0.8
                score += (if (ours) 1.0 else -1.0) * parity * w
            }
        }
        if (kotlin.math.abs(score) < 0.4) return
        val servingIsUs = score > 0
        for (t in rally.touches) t.team = if ((t.possession % 2 == 0) == servingIsUs) "us" else "them"
    }

    /** Suggested events, with landing spots inferred from the next touch when positions are known. */
    fun toEvents(rallies: List<Rally>, ourHalf: String?, dropOpponent: Boolean = true) = toEvents(rallies, { ourHalf }, { null }, dropOpponent)

    /** [ourHalfAt] / [setAt]: our side and the set number at a video time (teams switch sides every set). */
    fun toEvents(
        rallies: List<Rally>, ourHalfAt: (Double) -> String?, setAt: (Double) -> Int?, dropOpponent: Boolean = true,
    ): List<Map<String, Any?>> {
        val events = ArrayList<Map<String, Any?>>()
        for ((ri, rally) in rallies.withIndex()) {
            for ((i, t) in rally.touches.withIndex()) {
                if (dropOpponent && t.team == "them") continue
                val landing = landingSpot(rally, i, ourHalfAt(t.t))
                events += mapOf(
                    "t" to round2(max(0.0, t.t)),
                    "action" to t.action,
                    "jersey" to t.jersey,
                    "confidence" to round2(confidence(t)),
                    "hint" to t.kind.takeIf { it != HEARD },
                    "x" to landing?.x?.let(::round2),
                    "y" to landing?.y?.let(::round2),
                    "rally" to ri + 1,
                    "poss" to t.possession,
                    "set_no" to setAt(t.t),
                )
            }
        }
        return events
    }

    /**
     * How sure the suggestion is. The sound alone says little (a clap is as loud as
     * a dig, a far-side touch quieter than either), so when the ball was seen the
     * picture decides most of it: ball at the touching player = likely a touch.
     */
    fun confidence(t: Touch): Double {
        var c = when (t.kind) {
            HEARD -> 0.35 + 0.3 * t.strength
            QUIET -> 0.3
            else -> 0.2
        }
        if (t.action == "serve") c += 0.1
        t.ball?.let { c = 0.4 * c + 0.6 * (0.15 + 0.8 * it) }
        if (t.jersey != null) c = 0.5 * c + 0.5 * t.jerseyConf
        return min(c, 0.95)
    }

    /**
     * Receive -> where the next (same team) touch happened, i.e. where the pass went.
     * Attack/serve -> where the other team touched it next. In app court coordinates
     * (our baseline y = 0), so the picture is mirrored when we play on the far half.
     */
    private fun landingSpot(rally: Rally, i: Int, ourHalf: String?): P? {
        if (ourHalf == null) return null
        val t = rally.touches[i]
        val next = rally.touches.getOrNull(i + 1) ?: return null
        val wanted = when (t.action) {
            "receive", "dig" -> next.possession == t.possession
            "attack", "serve" -> next.possession == t.possession + 1
            else -> false
        }
        val p = next.pos ?: return null
        if (!wanted) return null
        return if (ourHalf == "near") p else P(9.0 - p.x, 18.0 - p.y)
    }

    private fun round2(v: Double) = round(v * 100) / 100
}
