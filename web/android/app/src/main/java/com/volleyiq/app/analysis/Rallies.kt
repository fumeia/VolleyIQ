package com.volleyiq.app.analysis

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
)

class Rally(val touches: MutableList<Touch>)

object Rallies {
    const val MAX_GAP = 3.5
    const val MIN_CONTACTS = 2
    const val CUT_GUARD = 0.15

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
    fun toEvents(rallies: List<Rally>, ourHalf: String?, dropOpponent: Boolean = true): List<Map<String, Any?>> {
        val events = ArrayList<Map<String, Any?>>()
        for ((ri, rally) in rallies.withIndex()) {
            for ((i, t) in rally.touches.withIndex()) {
                if (dropOpponent && t.team == "them") continue
                var conf = 0.35 + 0.3 * t.strength + if (t.action == "serve") 0.1 else 0.0
                if (t.jersey != null) conf = 0.5 * conf + 0.5 * t.jerseyConf
                val landing = landingSpot(rally, i, ourHalf)
                events += mapOf(
                    "t" to round2(max(0.0, t.t)),
                    "action" to t.action,
                    "jersey" to t.jersey,
                    "confidence" to round2(min(conf, 0.95)),
                    "x" to landing?.x?.let(::round2),
                    "y" to landing?.y?.let(::round2),
                    "rally" to ri + 1,
                    "poss" to t.possession,
                )
            }
        }
        return events
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
