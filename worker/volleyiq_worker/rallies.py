"""Turns raw contact times into rallies and labelled touches.

The model of a rally is the textbook one: serve, then possessions of up to
three touches (first touch, set, attack) that alternate between the teams.
That is wrong often enough (overpasses, block touches, freeballs) that all
output is marked as a *suggestion* with a modest confidence; the review pass
is where the coach fixes it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

MAX_GAP = 3.5          # seconds without a contact ends a rally
CUT_GUARD = 0.15       # seconds around an edit cut where contacts are splice artefacts
MIN_CONTACTS = 2
TOUCH_INTERVAL = 1.2   # default time between touches, when a match has too few to measure it
MIN_FILL_GAP = 1.6     # shorter gaps are never filled (a serve or a high free ball takes that long)
QUIET_BOOST = 2.0      # quiet sounds come from this much more sensitive a detector
MIN_SPACING = 0.3
SNAP = 0.45


@dataclass
class Touch:
    t: float
    strength: float
    action: str = "attack"
    possession: int = 0            # 0 = serving team's serve, then 1, 2, ... alternating
    jersey: int | None = None
    jersey_conf: float = 0.0
    team: str | None = None        # "us" | "them" | None (unknown)
    kind: str = "heard"            # "heard" | "quiet" (faint sound in a gap) | "gap" (guessed from the rhythm)


@dataclass
class Rally:
    touches: list[Touch] = field(default_factory=list)

    @property
    def start(self):
        return self.touches[0].t

    @property
    def end(self):
        return self.touches[-1].t


def segment_rallies(
    contacts: list[tuple[float, float]],
    whistles: list[tuple[float, float]] | None = None,
    cuts: list[float] | None = None,
) -> list[Rally]:
    """Groups contacts into rallies. Boundaries: whistles, edit cuts, or a long silence."""
    cuts = sorted(cuts or [])
    # The audio splice at an edit cut sounds like a contact; drop anything right at a cut.
    contacts = [(t, s) for t, s in contacts if not any(abs(t - c) < CUT_GUARD for c in cuts)]
    boundaries = sorted([w[0] for w in (whistles or [])] + cuts)
    rallies: list[Rally] = []
    cur: list[Touch] = []
    bi = 0
    for t, s in sorted(contacts):
        crossed = False
        while bi < len(boundaries) and boundaries[bi] < t:
            crossed = crossed or bool(cur and boundaries[bi] > cur[-1].t)
            bi += 1
        if cur and (t - cur[-1].t > MAX_GAP or crossed):
            rallies.append(Rally(cur))
            cur = []
        cur.append(Touch(t, s))
    if cur:
        rallies.append(Rally(cur))
    return [r for r in rallies if len(r.touches) >= MIN_CONTACTS]


def quiet_contacts(normal: list[tuple[float, float]], sensitive: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Contacts only a more sensitive detector hears, away from the normal ones."""
    return [(t, s) for t, s in sensitive if not any(abs(t - n) < MIN_SPACING for n, _ in normal)]


def typical_interval(found: list[Rally]) -> float:
    """The match's own rhythm: median time between consecutive heard touches of a rally."""
    d = sorted(b.t - a.t for r in found for a, b in zip(r.touches, r.touches[1:]) if 0.3 <= b.t - a.t <= 2.5)
    return TOUCH_INTERVAL if len(d) < 10 else min(1.3, max(0.8, d[len(d) // 2]))


def fill_gaps(rally: Rally, quiet: list[tuple[float, float]], interval: float = TOUCH_INTERVAL) -> None:
    """Adds touches where the rally rhythm has a hole (far-side touches are often too faint to hear):
    at a quiet sound in the expected spot if there is one, else as a guess at the expected time."""
    src, out = rally.touches, []
    for i, cur in enumerate(src):
        out.append(cur)
        if i + 1 == len(src):
            break
        nxt = src[i + 1]
        gap = nxt.t - cur.t
        missing = 0 if gap < MIN_FILL_GAP else min(2, max(0, round(gap / interval) - 1))
        for k in range(1, missing + 1):
            ideal = cur.t + gap * k / (missing + 1)
            after = out[-1].t + MIN_SPACING
            near = [(t, s) for t, s in quiet if abs(t - ideal) < SNAP and after < t < nxt.t - MIN_SPACING]
            if near:
                t, s = max(near, key=lambda q: q[1])
                out.append(Touch(t, s, kind="quiet"))
            elif after < ideal < nxt.t - MIN_SPACING:
                out.append(Touch(ideal, 0.0, kind="gap"))
    rally.touches = out


def label_rally(rally: Rally) -> None:
    touches = rally.touches
    touches[0].action = "serve"
    touches[0].possession = 0
    possession, k = 1, 0
    for touch in touches[1:]:
        # Max three touches per side: the fourth contact belongs to the other team.
        if k == 3:
            possession += 1
            k = 0
        first_of_rally = possession == 1
        if k == 0:
            touch.action = "receive" if first_of_rally else "dig"
        elif k == 1:
            touch.action = "set"
        else:
            touch.action = "attack"
        touch.possession = possession
        k += 1


def assign_teams(rally: Rally, roster_numbers: set[int]) -> None:
    """Uses jersey reads to decide which possessions are ours and propagates by alternation."""
    # Positive score = the serving side is us. Possessions alternate, so a read on an
    # odd possession counts for the opposite side.
    score = 0.0
    for touch in rally.touches:
        if touch.jersey is None or touch.jersey_conf < 0.4:
            continue
        side = 1.0 if touch.jersey in roster_numbers else -1.0
        parity = 1.0 if touch.possession % 2 == 0 else -1.0
        score += side * parity * touch.jersey_conf
    if abs(score) < 0.4:
        return
    serving_is_us = score > 0
    for touch in rally.touches:
        same_side = touch.possession % 2 == 0
        touch.team = "us" if same_side == serving_is_us else "them"


def to_events(rallies: list[Rally], drop_opponent: bool = True) -> list[dict]:
    events = []
    for ri, rally in enumerate(rallies, start=1):
        for touch in rally.touches:
            if drop_opponent and touch.team == "them":
                continue
            base = {"heard": 0.35 + 0.3 * touch.strength, "quiet": 0.3}.get(touch.kind, 0.2)
            if touch.action == "serve":
                base += 0.1
            conf = base
            if touch.jersey is not None:
                conf = 0.5 * base + 0.5 * touch.jersey_conf
            events.append({
                "t": round(max(0.0, touch.t), 2),
                "action": touch.action,
                "jersey": touch.jersey,
                "confidence": round(min(conf, 0.95), 2),
                "rally": ri,
                "poss": touch.possession,
                "hint": None if touch.kind == "heard" else touch.kind,
            })
    return events
