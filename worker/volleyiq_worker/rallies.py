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


@dataclass
class Touch:
    t: float
    strength: float
    action: str = "attack"
    possession: int = 0            # 0 = serving team's serve, then 1, 2, ... alternating
    jersey: int | None = None
    jersey_conf: float = 0.0
    team: str | None = None        # "us" | "them" | None (unknown)


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
    for rally in rallies:
        for touch in rally.touches:
            if drop_opponent and touch.team == "them":
                continue
            base = 0.35 + 0.3 * touch.strength
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
            })
    return events
