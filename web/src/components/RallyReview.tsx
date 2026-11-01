import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTION_BY_CODE, isNetSpot, wantsSpots, type ActionCode } from '../lib/actions';
import { ActionPicker } from './ActionPicker';
import { api, type AiBudget, type AiStats, type AiTouch, type Match, type Player, type VEvent } from '../lib/api';
import { touchPictures } from '../lib/frames';
import { plural } from './analysis/ui';
import { aiWord, courtPosition, feedbackFor, nextTouch, planAnswer } from '../lib/aiTrust';
import { aiPrefs, checkRally, estimate, money } from '../lib/aiCheck';
import { courtFields, type Pt } from '../lib/court';
import { alreadySaved, duplicates, groupRallies, guessServing, isOurs, outcome, rallyTemplate, servingAt, setAt, type Serving } from '../lib/rallyReview';
import { pointsOfSet, rotationAfter, suggest } from '../lib/rotation';
import { SpotSheet } from './SpotSheet';
import { ourHalfAt } from '../lib/calibration';
import { fmtTime } from './TagPad';
import { FrameStep, SpeedControl } from './SpeedControl';
import type { PlayerHandle } from './VideoPlayer';

interface Props {
  match: Match;
  suggested: VEvent[];
  /** Saved events: the points so far give the rotation. */
  confirmed: VEvent[];
  players: Player[];
  player: React.RefObject<PlayerHandle | null>;
  /** Court spots as in the tagging settings: off, every action, or only serve / pass / attack. */
  spots: { location: 'points' | 'zones' | 'off'; scope: 'all' | 'key' };
  update: (e: VEvent, patch: Partial<VEvent>) => Promise<void>;
  add: (e: Partial<VEvent>) => string;
  removeMany: (list: VEvent[]) => Promise<void>;
  removeByClient: (clientId: string) => void;
  reload: () => Promise<unknown>;
  onTouchView: () => void;
  onLineup: (set: number) => void;
  onExit: () => void;
}

/** One question at a time for the selected touch. */
type Step = 'player' | 'action' | 'from' | 'to' | 'grade';

// Positions in court order as seen from behind our baseline: front row, then back row.
const COURT_ORDER = [4, 3, 2, 5, 6, 1];
const PRE_ROLL = 2;
const POST_ROLL = 1.5;
const STEP_PAUSE_MS = 700;
/** Swipe a chip up this far (px) to remove it. */
const CHIP_SWIPE = 40;

const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/**
 * Review one rally at a time. The rally plays once and its touches show as chips.
 * Tapping a chip walks through it: player, then action, then the court spots (the
 * court opens by itself), then on to the next touch. One button settles the rally
 * ("We won" / "They won" also records how the point ended).
 */
export function RallyReview({ match, suggested, confirmed, players, player, spots, update, add, removeMany, removeByClient, reload, onTouchView, onLineup, onExit }: Props) {
  const { rallies, info } = useMemo(() => groupRallies(suggested, match.calibration), [suggested, match.calibration]);
  const [idx, setIdx] = useState(0);
  const r = rallies[Math.min(idx, rallies.length - 1)];
  const [drafts, setDrafts] = useState<Record<number, Partial<VEvent>>>({});
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [serving, setServing] = useState<Serving>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [step, setStep] = useState<Step>('player');
  const [from, setFrom] = useState<Pt | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [speed, setSpeed] = useState(() => Number(load('viq:reviewSpeed', '1')) || 1);
  const [stepPause, setStepPause] = useState(() => load('viq:stepPause', '0') === '1');
  // Off by default: opening a touch jumps to its frame (paused) instead of replaying a
  // short clip, so the video does not keep pausing itself as you step through touches.
  const [replay, setReplay] = useState(() => load('viq:replayTouch', '0') === '1');
  const [vidPlaying, setVidPlaying] = useState(false);
  // Per-touch override of the ours/theirs guess (tap a chip's toggle). Resets per rally.
  const [owner, setOwner] = useState<Map<number, 'us' | 'them'>>(new Map());
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [last, setLast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  // AI check (optional, needs an AI backend on the server and a local video file).
  const [aiOn, setAiOn] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  // The AI's answer per touch of this rally (from the check of this rally, or of all rallies before).
  const [answers, setAnswers] = useState<Map<number, AiTouch>>(new Map());
  const [aiSummary, setAiSummary] = useState<{ text: string; undo?: () => void } | null>(null);
  const [aiStats, setAiStats] = useState<AiStats | null>(null);
  const [budget, setBudget] = useState<AiBudget | null>(null);
  const chipDrag = useRef<{ id: number; x: number; y: number; el: HTMLElement; moved: boolean } | null>(null);
  const addSide = useRef<'us' | 'them' | null>(null);
  // Who serves a rally just added by hand (from the saved points before it), set when it opens.
  const addedServe = useRef<{ start: number; serving: Serving } | null>(null);
  const stopAt = useRef<number | null>(null);
  const passed = useRef<Set<number>>(new Set());
  const jumpTo = useRef<number | null>(null);
  const selectAt = useRef<number | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  // Set while the whole rally plays; when it ends, the first touch that needs a player opens.
  const rallyPlaying = useRef(false);
  const openFirst = useRef<() => void>(() => {});
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const lineup = r ? match.lineups?.[String(r.set)] : undefined;
  const rotation = useMemo(
    () => (r && lineup ? rotationAfter(lineup, pointsOfSet(confirmed, r.set, r.start), players, r.start) : null),
    [r?.key, r?.start, lineup, confirmed, players],
  );

  // After an undo or a new rally, show that rally.
  useEffect(() => {
    if (jumpTo.current == null) return;
    const i = rallies.findIndex((x) => x.start >= jumpTo.current! - 0.05);
    if (i >= 0) { setIdx(i); jumpTo.current = null; }
  }, [rallies]);

  // New rally: fresh state (touches heard twice already folded), play it.
  useEffect(() => {
    if (!r) return;
    const base = { drafts: {}, removed: new Set([...duplicates(r.events), ...alreadySaved(r.events, confirmed)]), owner: new Map<number, 'us' | 'them'>() };
    const added = addedServe.current && Math.abs(addedServe.current.start - r.start) < 0.05 ? addedServe.current : null;
    addedServe.current = null;
    setServing(rotation ? (rotation.weServe ? 'us' : 'them') : added ? added.serving : guessServing(r.events, info));
    setSel(null);
    // Answers from an earlier AI check (e.g. of all rallies after the detection): applied right away.
    const stored = new Map(r.events.filter((e) => e.ai).map((e) => [e.id, e.ai!] as const));
    if (stored.size) {
      const got = applyAnswers(stored, base);
      setDrafts(got.drafts); setRemoved(got.removed); setOwner(got.owner);
      setAiSummary({ text: `From the AI check: ${got.text}`, undo: () => { setDrafts(base.drafts); setRemoved(base.removed); setOwner(base.owner); setAiSummary(null); } });
    } else {
      setDrafts(base.drafts); setRemoved(base.removed); setOwner(base.owner);
      setAiSummary(null);
    }
    setAnswers(stored);
    playRally();
  }, [r?.key, r?.start]);

  useEffect(() => {
    api.touchCheckEnabled().then((x) => {
      setAiOn(x.enabled);
      if (!x.enabled) return;
      api.aiStats().then((s) => setAiStats(s.fields)).catch(() => {});
      api.aiBudget().then(setBudget).catch(() => {});
    }).catch(() => setAiOn(false));
  }, []);

  // A touch just added by hand: open it.
  useEffect(() => {
    if (selectAt.current == null || !r) return;
    const e = r.events.find((x) => x.t != null && Math.abs(x.t - selectAt.current!) < 0.02);
    if (e) {
      const side = addSide.current;
      if (side) setOwner((m) => new Map(m).set(e.id, side));
      open(e, false);
      selectAt.current = null;
      addSide.current = null;
    }
  }, [rallies]);

  // Keep the open question in view (the video stays pinned above it).
  useEffect(() => {
    if (sel != null) editor.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel, step]);

  // Follow the video: highlight the touch being played, stop after the clip, optional pause at each touch.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const p = player.current;
      const t = p?.time();
      if (!p || t == null) return;
      setNow(t);
      setVidPlaying(p.isPlaying());
      if (!p.isPlaying()) return;
      if (stopAt.current != null && t >= stopAt.current) {
        p.pause();
        stopAt.current = null;
        if (rallyPlaying.current) { rallyPlaying.current = false; openFirst.current(); }
        return;
      }
      if (stepPause && r) {
        const hit = r.events.find((e) => e.t != null && e.t <= t && e.t > t - 0.4 && !passed.current.has(e.id));
        if (hit) {
          passed.current.add(hit.id);
          p.pause();
          window.setTimeout(() => player.current?.play(), STEP_PAUSE_MS);
        }
      }
    }, 120);
    return () => clearInterval(timer);
  }, [r?.key, stepPause]);

  // Desktop keys: W = we won, L = they won, N = not a rally, Enter = save without point.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || busy || !r) return;
      const k = e.key.toLowerCase();
      if (k === 'w') finish('won');
      else if (k === 'l') finish('lost');
      else if (k === 'n') notARally();
      else if (k === 'enter') finish(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function playFrom(t0: number, t1: number) {
    const p = player.current;
    if (!p) return;
    p.setRate(speed);
    p.seek(Math.max(0, t0));
    p.play();
    stopAt.current = t1;
    passed.current = new Set();
  }
  const playRally = () => {
    if (!r) return;
    playFrom(r.start - PRE_ROLL, r.end + POST_ROLL);
    rallyPlaying.current = true;
  };

  /**
   * A touch (or a whole rally) the analysis missed or that was deleted: added at the
   * current video time as a suggestion, so it is saved with the rest of its rally.
   */
  async function addAt(newRally: boolean) {
    const t = player.current?.time();
    if (t == null || busy || (!r && !newRally)) return;
    setBusy(true);
    try {
      player.current?.pause();
      const at = Math.round(t * 100) / 100;
      if (newRally) return await addRally(at);
      const numbered = !r || /^\d+$/.test(r.key);
      const rally = numbered ? (newRally || !r ? 900000 + Math.round(at * 10) : Number(r.key)) : null;
      // The likely touch after the one before it: its action, and the same or the other team.
      const prev = newRally || !r ? null : [...r.events].reverse().find((e) => (e.t ?? 0) < at && !removed.has(e.id)) ?? null;
      const guess = nextTouch(prev ? view(prev).action : null);
      const prevSide = prev ? (isTheirs(prev) ? 'them' : 'us') : serving === 'them' ? 'them' : 'us';
      addSide.current = newRally || !prev ? null : guess.sameTeam ? prevSide : prevSide === 'us' ? 'them' : 'us';
      const poss = !prev ? 0 : possOf(prev) + (guess.sameTeam ? 0 : 1);
      await api.addEvent(match.id, {
        t: at, action: guess.action, status: 'suggested', source: 'auto',
        rally, poss: rally == null ? null : poss, set_no: newRally || !r ? setAt(match.calibration, at) : r.set,
      });
      selectAt.current = at;
      await reload();
    } finally {
      setBusy(false);
    }
  }

  /**
   * A rally the detection missed, starting at [at]: the touches of a typical rally to
   * fix up, with the side that serves from the saved points before it (and the
   * rotation from the line-up, as for every rally).
   */
  async function addRally(at: number) {
    const set = setAt(match.calibration, at);
    const serve = servingAt(pointsOfSet(confirmed, set, at), match.lineups?.[String(set)]?.weServeFirst);
    const rally = 900000 + Math.round(at * 10);
    for (const x of rallyTemplate(at, serve)) {
      await api.addEvent(match.id, { t: x.t, action: x.action, status: 'suggested', source: 'auto', rally, poss: x.poss, set_no: set });
    }
    addedServe.current = { start: at, serving: serve };
    jumpTo.current = at;
    await reload();
  }

  async function runUndo() {
    if (!last || busy) return;
    setBusy(true);
    try { await last.undo(); setLast(null); } finally { setBusy(false); }
  }

  if (!r) {
    return (
      <div className="pad">
        <p>All rallies reviewed.</p>
        <button className="btn wide" disabled={busy} onClick={() => addAt(true)}>+ Rally the analysis missed, at the current video time</button>
        {last && <button className="btn wide" onClick={runUndo}>↶ Undo: {last.text}</button>}
        <button className="btn btn-primary wide" onClick={onExit}>Back to tagging</button>
      </div>
    );
  }

  // The server and the setter are filled in when the app could not read the number:
  // the server needs the line-up, but the setter is known from the roles alone.
  const auto = (e: VEvent): Partial<VEvent> => {
    if (e.player_id != null || !isOurs(info.get(e.id), serving)) return {};
    const action = drafts[e.id]?.action ?? e.action;
    if (!['serve', 'ace', 'serve_error', 'set'].includes(action)) return {};
    const id = suggest(action, players, rotation).likely;
    const p = players.find((x) => x.id === id);
    return p ? { player_id: p.id, jersey: p.number } : {};
  };
  const view = (e: VEvent): VEvent => ({ ...e, ...auto(e), ...drafts[e.id] });
  const isTheirs = (e: VEvent) => {
    const o = owner.get(e.id);
    if (o) return o === 'them';
    return !isOurs(info.get(e.id), serving);
  };
  /** Mark a single touch as ours / theirs, overriding the parity guess. */
  function setTouchOwner(e: VEvent, side: 'us' | 'them') {
    setOwner((m) => new Map(m).set(e.id, side));
    if (side === 'them') setSel(null);
    else open(e, false);
  }
  const ours = (e: VEvent) => !isTheirs(e) && !removed.has(e.id);
  const kept = r.events.filter(ours);
  const lastTouch = [...r.events].reverse().find((e) => !removed.has(e.id)) ?? null;
  const lastIsOurs = lastTouch ? ours(lastTouch) : true;
  const playing = [...r.events].reverse().find((e) => now != null && e.t != null && e.t <= now + 0.1);
  const selected = r.events.find((e) => e.id === sel) ?? null;
  const num = (v: VEvent) => {
    const p = players.find((x) => x.id === v.player_id);
    return p ? `#${p.number ?? '?'}` : v.jersey != null ? `#${v.jersey}?` : '';
  };
  const outcomeText = (won: boolean) => {
    const o = outcome(lastTouch ? { id: lastTouch.id, action: view(lastTouch).action } : null, lastIsOurs, won);
    if (!o.change) return o.add === 'opp_error' ? 'their error' : 'their point';
    const def = ACTION_BY_CODE[o.change.action];
    return `${num(view(lastTouch!))} ${o.change!.value === 0 ? 'Rec 0' : def.short}`;
  };
  const patch = (e: VEvent, p: Partial<VEvent>) => setDrafts((d) => ({ ...d, [e.id]: { ...d[e.id], ...p } }));

  /** Open a touch at its first question and replay its moment (stopping right after the contact). */
  function open(e: VEvent, play = true) {
    rallyPlaying.current = false;
    setSel(e.id);
    setStep('player');
    const v = view(e);
    setFrom(v.fx != null && v.fy != null ? { x: v.fx, y: v.fy } : null);
    if (e.t != null) {
      if (play && replay) playFrom(e.t - 1.5, e.t + 0.3);
      // Default: just show the touch's frame, paused, without replaying a clip.
      else { stopAt.current = null; player.current?.pause(); player.current?.seek(e.t); }
    }
  }

  openFirst.current = () => {
    if (sel != null) return;
    const first = r.events.find((e) => ours(e) && view(e).player_id == null);
    if (first) open(first, false);
  };

  /** Next of our touches after [e]; none left = the rally is ready to be settled. */
  function advance(e: VEvent) {
    const next = r.events.find((x) => (x.t ?? 0) > (e.t ?? 0) && ours(x));
    if (next) open(next);
    else setSel(null);
  }

  /** The touch before [e] in this rally (any side), to step back. */
  const prevTouch = (e: VEvent) => [...r.events].reverse().find((x) => (x.t ?? 0) < (e.t ?? 0) && !removed.has(x.id)) ?? null;

  function chooseAction(e: VEvent, code: ActionCode) {
    const v = view(e);
    patch(e, { action: code, value: code === 'receive' ? v.value : null });
    if (wantsSpots(code, spots.location, spots.scope)) {
      setStep(ACTION_BY_CODE[code].court === 'path' ? 'from' : 'to');
      // The contact frame, to see where it happened.
      if (e.t != null) { player.current?.pause(); player.current?.seek(e.t); }
    } else if (code === 'receive') setStep('grade');
    else advance(e);
  }

  function pickSpot(e: VEvent, p: Pt) {
    if (step === 'from') { setFrom(p); setStep('to'); return; }
    patch(e, courtFields(view(e).action, from, p));
    advance(e);
  }


  async function finish(result: 'won' | 'lost' | null) {
    if (busy) return;
    setBusy(true);
    const rally = r;
    try {
      const drop = rally.events.filter((e) => !ours(e));
      const o = result
        ? outcome(lastTouch ? { id: lastTouch.id, action: view(lastTouch).action } : null, lastIsOurs, result === 'won')
        : {};
      const originals = kept.map((e) => ({ ...e }));
      await Promise.all(kept.map((e) => update(e, {
        ...auto(e),
        ...drafts[e.id],
        ...(o.change?.id === e.id ? { action: o.change.action, ...(o.change.value !== undefined ? { value: o.change.value } : {}) } : {}),
        set_no: e.set_no ?? rally.set,
        status: 'confirmed',
      })));
      const clientId = o.add ? add({ action: o.add, value: o.addValue ?? null, t: rally.end + 0.5, set_no: rally.set }) : null;
      if (drop.length) await removeMany(drop);
      learn(rally.events, (e) => (o.change?.id === e.id ? o.change.action : view(e).action));
      navigator.vibrate?.(result ? [20, 40, 20] : 15);
      const text = `rally at ${fmtTime(rally.start)}${result ? (result === 'won' ? ' (won)' : ' (lost)') : ''}`;
      setLast({
        text,
        undo: async () => {
          if (clientId) removeByClient(clientId);
          await Promise.all(originals.map((e) => update(e, {
            action: e.action, value: e.value, player_id: e.player_id, jersey: e.jersey, zone: e.zone,
            x: e.x, y: e.y, fx: e.fx, fy: e.fy, set_no: e.set_no, status: 'suggested',
          })));
          await restore(drop);
          jumpTo.current = rally.start;
        },
      });
    } finally {
      setBusy(false);
    }
  }

  async function notARally() {
    if (busy) return;
    setBusy(true);
    const rally = r;
    try {
      await removeMany(rally.events);
      setLast({ text: `removed rally at ${fmtTime(rally.start)}`, undo: async () => { await restore(rally.events); jumpTo.current = rally.start; } });
    } finally {
      setBusy(false);
    }
  }

  // Deleted suggestions come back as new suggestions with the same content.
  async function restore(list: VEvent[]) {
    if (!list.length) return;
    for (const e of list) {
      const { id: _id, match_id: _m, client_id: _c, ...rest } = e;
      await api.addEvent(match.id, { ...rest, source: 'auto', status: 'suggested' });
    }
    await reload();
  }

  // Rally boundaries from the analysis can be off: join two rallies, or split one.
  const rallyNo = (x: { key: string; start: number }) => (/^\d+$/.test(x.key) ? Number(x.key) : 900000 + Math.round(x.start * 10));
  const possOf = (e: VEvent) => info.get(e.id)?.poss ?? 0;

  async function joinNext() {
    const next = rallies[idx + 1];
    if (!next || busy) return;
    setBusy(true);
    try {
      const k = rallyNo(r);
      const top = Math.max(0, ...r.events.map(possOf));
      const low = Math.min(...next.events.map(possOf));
      await Promise.all([
        ...r.events.map((e) => update(e, { rally: k, poss: possOf(e) })),
        // Possessions continue after this rally's last one.
        ...next.events.map((e) => update(e, { rally: k, poss: top + 1 + possOf(e) - low })),
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function splitAt(e: VEvent) {
    if (busy) return;
    setBusy(true);
    try {
      const at = e.t ?? 0;
      const k1 = rallyNo(r), k2 = 900000 + Math.round(at * 10);
      const base = possOf(e);
      await Promise.all(r.events.map((x) => ((x.t ?? 0) >= at
        ? update(x, { rally: k2, poss: Math.max(0, possOf(x) - base) }) // the new rally starts with a serve
        : update(x, { rally: k1, poss: possOf(x) }))));
      setSel(null);
    } finally {
      setBusy(false);
    }
  }

  function tapChip(e: VEvent) {
    if (removed.has(e.id)) {
      // Removed by mistake (or folded as a duplicate): bring it back.
      setRemoved((s) => { const n = new Set(s); n.delete(e.id); return n; });
      return open(e);
    }
    if (isTheirs(e)) return open(e);
    if (e.id === sel) { setSel(null); return; }
    open(e);
  }

  /** Answers → chip changes, as far as each kind of answer has proven right before. */
  function applyAnswers(found: Map<number, AiTouch>, base: { drafts: Record<number, Partial<VEvent>>; removed: Set<number>; owner: Map<number, 'us' | 'them'> }) {
    const drop = new Set(base.removed), side = new Map(base.owner);
    const fill: Record<number, Partial<VEvent>> = { ...base.drafts };
    let dropped = 0, actions = 0, numbers = 0, spots = 0;
    for (const e of r.events) {
      const a = found.get(e.id);
      if (!a) continue;
      const cur = { ...e, ...fill[e.id] };
      const plan = planAnswer(a, {
        stats: aiStats, action: cur.action, hasPlayer: cur.player_id != null,
        byNumber: (n) => roster.find((p) => p.number === n)?.id ?? null,
        atPosition: (pos) => rotation?.positions[pos - 1] ?? null,
      });
      if (plan.drop) { drop.add(e.id); dropped++; continue; }
      if (plan.side) side.set(e.id, plan.side);
      if (plan.action) { fill[e.id] = { ...fill[e.id], action: plan.action, value: plan.action === 'receive' ? cur.value : null }; actions++; }
      const p = plan.player && players.find((x) => x.id === plan.player!.id);
      if (p) {
        fill[e.id] = { ...fill[e.id], player_id: p.id, jersey: p.number };
        if (plan.player!.via === 'jersey') numbers++; else spots++;
      }
    }
    const parts = [dropped && `${dropped} not a touch`, actions && plural(actions, 'action'), numbers && `${plural(numbers, 'player')} by number`, spots && `${plural(spots, 'player')} by court position`].filter(Boolean);
    return { drafts: fill, removed: drop, owner: side, text: `${parts.length ? parts.join(', ') : 'nothing changed'}. Check the chips, then save the rally as usual.` };
  }

  /**
   * AI check of this rally: three frames per touch go to the vision model, which says
   * whether it is a touch, whose, which action, the number and where the player stands.
   * Answers are filled in as far as they are trusted (nothing is saved until the rally is).
   */
  async function aiCheck() {
    const url = player.current?.fileUrl();
    if (!url || aiBusy || !r) return;
    player.current?.pause();
    stopAt.current = null;
    const before = { drafts, removed, owner };
    try {
      const found = await checkRally(r.events, { match, players, url, examples: aiPrefs.examples() }, setAiBusy);
      const got = applyAnswers(found, before);
      setDrafts(got.drafts); setRemoved(got.removed); setOwner(got.owner);
      setAnswers(found);
      setAiSummary({
        text: `AI checked ${plural(found.size, 'touch')}: ${got.text}`,
        undo: () => { setDrafts(before.drafts); setRemoved(before.removed); setOwner(before.owner); setAiSummary(null); },
      });
      api.aiBudget().then(setBudget).catch(() => {});
    } catch (e) {
      setAiSummary({ text: e instanceof Error ? e.message : 'AI check failed' });
    } finally {
      setAiBusy(null);
    }
  }

  /**
   * After a rally is saved: was each AI answer right? That decides how far each kind of
   * answer is trusted next time. Touches it got wrong are kept on the server as examples
   * (the AI can be shown them later, when that option is on).
   */
  function learn(events: VEvent[], finalAction: (e: VEvent) => ActionCode) {
    const items: ReturnType<typeof feedbackFor> = [];
    const wrong: { e: VEvent; label: Parameters<typeof api.aiExample>[1] }[] = [];
    for (const e of events) {
      const a = answers.get(e.id);
      if (!a) continue;
      const v = view(e);
      const kept = !removed.has(e.id), mine = kept && !isTheirs(e);
      const pos = courtPosition(a.position, a.ourSide);
      const number = players.find((p) => p.id === v.player_id)?.number ?? null;
      const f = feedbackFor(a, { kept, ours: mine, action: finalAction(e), playerId: v.player_id, number, positionPlayer: pos != null ? rotation?.positions[pos - 1] ?? null : null });
      items.push(...f);
      if (f.some((x) => !x.correct && x.field !== 'position' && x.field !== 'jersey')) {
        wrong.push({ e, label: { contact: kept ? 'yes' : 'no', team: !kept ? 'unsure' : mine ? 'ours' : 'theirs', action: mine ? aiWord(finalAction(e)) ?? 'unknown' : 'unknown', jersey: mine ? number : null, ourSide: a.ourSide ?? null } });
      }
    }
    if (!items.length) return;
    api.aiFeedback(items).then(() => api.aiStats()).then((s) => setAiStats(s.fields)).catch(() => {});
    const url = player.current?.fileUrl();
    if (!url) return;
    // In the background, two at most per rally: the newest corrections are the useful ones.
    (async () => {
      for (const w of wrong.slice(0, 2)) {
        const [pic] = await touchPictures(url, [w.e.t!], () => 'Example');
        await api.aiExample(pic, w.label);
      }
    })().catch(() => {});
  }

  /** Chips: swipe up to remove, tap to open. The rally card's own left/right swipe is left alone. */
  const chipDown = (e: VEvent) => (ev: React.PointerEvent<HTMLElement>) => {
    ev.stopPropagation();
    // Keep getting the moves when the finger leaves the chip upwards.
    ev.currentTarget.setPointerCapture?.(ev.pointerId);
    chipDrag.current = { id: e.id, x: ev.clientX, y: ev.clientY, el: ev.currentTarget, moved: false };
  };
  function chipMove(ev: React.PointerEvent<HTMLElement>) {
    const d = chipDrag.current;
    if (!d) return;
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
    if (!d.moved && (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy))) return;
    d.moved = true;
    const up = Math.min(0, dy);
    d.el.classList.add('dragging');
    d.el.style.transform = `translateY(${up}px)`;
    d.el.style.opacity = String(Math.max(0.2, 1 + up / 90));
  }
  function chipUp(e: VEvent, ev: React.PointerEvent<HTMLElement>) {
    const d = chipDrag.current;
    chipDrag.current = null;
    if (!d) return;
    d.el.classList.remove('dragging');
    d.el.style.transform = '';
    d.el.style.opacity = '';
    if (!d.moved) return tapChip(e);
    if (ev.clientY - d.y < -CHIP_SWIPE && !removed.has(e.id)) removeChip(e);
  }
  function chipCancel() {
    const d = chipDrag.current;
    chipDrag.current = null;
    if (d) { d.el.classList.remove('dragging'); d.el.style.transform = ''; d.el.style.opacity = ''; }
  }
  function removeChip(e: VEvent) {
    navigator.vibrate?.(10);
    setRemoved((s) => new Set(s).add(e.id));
    if (sel === e.id) advance(e);
  }

  function togglePlay() {
    const p = player.current;
    if (!p) return;
    if (p.isPlaying()) { stopAt.current = null; p.pause(); }
    else { p.setRate(speed); p.play(); }
  }

  function pickSpeed(s: number) {
    setSpeed(s);
    store('viq:reviewSpeed', String(s));
    player.current?.setRate(s);
  }

  // Swipe the rally card: left = not a rally, right = save without point.
  function onSwipeEnd(e: React.PointerEvent) {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 90 || Math.abs(e.clientY - s.y) > 60) return;
    if (dx < 0) notARally();
    else finish(null);
  }

  const sv = selected ? view(selected) : null;
  const def = sv ? ACTION_BY_CODE[sv.action] : null;
  const eligible = sv ? suggest(sv.action, players, rotation).eligible : null;
  // On-court players first (front row 4-3-2, back row 5-6-1), then the bench.
  const court = rotation
    ? COURT_ORDER.map((pos) => players.find((p) => p.id === rotation.positions[pos - 1])).filter((p): p is Player => !!p)
    : [];
  const bench = roster.filter((p) => !court.includes(p));
  const setterPos = rotation ? rotation.positions.findIndex((id) => players.find((p) => p.id === id)?.role === 'S') + 1 : 0;
  const removedCount = r.events.filter((e) => removed.has(e.id)).length;

  const jersey = (p: Player) => (
    <button key={p.id} className={`jersey role-${p.role} ${sv?.player_id === p.id ? 'is-selected' : ''} ${eligible && !eligible.has(p.id) ? 'dim' : ''}`}
      onClick={() => { if (!selected) return; patch(selected, { player_id: p.id, jersey: p.number }); setStep('action'); }}>
      <span className="jersey-num">{p.number ?? '–'}</span>
      <span className="jersey-name">{p.name.split(' ')[0]}</span>
    </button>
  );

  return (
    <div className="pad rally-review">
      <div className="rr-head">
        <button className="rr-play" onClick={togglePlay} title={vidPlaying ? 'Pause' : 'Play'}>{vidPlaying ? '⏸' : '▶'}</button>
        <span>Rally <b>{Math.min(idx, rallies.length - 1) + 1}</b>/{rallies.length} · {fmtTime(r.start)} · Set {r.set}</span>
        <button className="btn-ghost small" onClick={() => setHelp(!help)} title="How this works">?</button>
        <button className="btn-ghost small" onClick={onTouchView} title="Review touch by touch">≡</button>
        <button className="btn-ghost small" onClick={onExit}>Done</button>
      </div>

      {help && (
        <div className="help-box small" onClick={() => setHelp(false)}>
          <p><b>One rally at a time.</b> It plays once; then the first touch without a player opens.</p>
          <p><b>Tap a touch</b>: player → action → court spots (where it was played from, where it went) → the next touch opens by itself. <b>Next ▸</b> keeps a touch as it is.</p>
          <p><b>Swipe a touch up</b> to remove it (noise, a double). Removed touches stay as a small ↺ chip: tap it to bring the touch back. Greyed, struck-through chips are the other team's touches.</p>
          <p><b>Fix the rally</b>: <b>Touch here</b> adds a missed touch at the video time (it guesses the action from the touch before: serve → pass → set → attack → dig), <b>New rally here</b> (or <b>◀ + Rally</b> before the first one) starts a rally the detection missed, with the touches of a typical rally to fix up (who serves comes from the points before), <b>Join next</b> merges two rallies, <b>New rally from here</b> (on an open touch) splits one.</p>
          <p><b>▶ / ⏸</b> (top-left) plays or pauses the video. Opening a touch just shows its frame; turn on <b>Replay touch</b> to play the 1.5 s before it instead (to see how the ball came).</p>
          <p><b>AI check</b> (when set up on the server, with a video file): three frames per touch go to the AI. It marks noise, sorts ours / theirs and fills in actions and players as far as its answers have proven right before. Chips it changed get a ✨. Nothing is saved until you save the rally, and every saved rally teaches it how far to trust each kind of answer.</p>
          <p><b>We won / They won</b> saves the rally and turns the last touch into the point or the error. <b>✕</b> = not a rally (noise). Swipe the rally card left = not a rally, right = save. Keys: W, L, N, Enter.</p>
          <p className="muted">Tap to close.</p>
        </div>
      )}

      <div className="rally-card" onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={onSwipeEnd}>
        <div className="strip">
          {r.events.map((e) => {
            const v = view(e);
            const gone = removed.has(e.id);
            const note = answers.get(e.id) ? aiNote(answers.get(e.id)!) : undefined;
            return (
              <button key={e.id}
                className={`touch-chip ${isTheirs(e) ? 'theirs' : ''} ${gone ? 'gone' : ''} ${sel === e.id ? 'sel' : ''} ${playing?.id === e.id ? 'now' : ''} ${!e.hint && (e.confidence ?? 1) < 0.4 ? 'weak' : ''}`}
                title={gone ? `Removed: tap to bring it back${note ? ` · ${note}` : ''}` : note ?? 'Tap to edit · swipe up to remove'}
                onPointerDown={chipDown(e)} onPointerMove={chipMove} onPointerUp={(ev) => chipUp(e, ev)} onPointerCancel={chipCancel}
                onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tapChip(e); } else if (ev.key === 'Delete' || ev.key === 'Backspace') removeChip(e); }}>
                {gone ? <span>↺ {ACTION_BY_CODE[v.action]?.short ?? v.action}</span> : <>
                  <b>{ACTION_BY_CODE[v.action]?.short ?? v.action}</b>
                  <span>{`${num(v)}${e.hint ? ' ?' : ''}${v.x != null || v.fx != null ? ' •' : ''}`}{note ? ' (AI)' : ''}</span>
                </>}
              </button>
            );
          })}
        </div>
        {!selected && <p className="swipe-hint">Tap a touch to edit · swipe it up to remove{removedCount > 0 ? ` · ${removedCount} removed (tap ↺ to restore)` : ''}</p>}

        {!selected && <>
          <div className="tool-row">
            <ToolBtn icon="＋" label="Touch here" sub={now != null ? fmtTime(now) : undefined} disabled={busy || now == null} onClick={() => addAt(false)}
              title="Add a missed touch at the current video time" />
            <ToolBtn icon="⇤" label="New rally here" sub={now != null ? fmtTime(now) : undefined} tone="split" disabled={busy || now == null} onClick={() => addAt(true)}
              title="Start a new rally at the current video time" />
            <ToolBtn icon="⇥" label="Join next rally" tone="split" disabled={busy || idx >= rallies.length - 1} onClick={joinNext}
              title="The next rally is part of this one (merge them)" />
            <ToolBtn icon="⌫" label="Clear touches" tone="danger" disabled={r.events.every((e) => removed.has(e.id))}
              onClick={() => { setRemoved(new Set(r.events.map((e) => e.id))); setSel(null); }} title="Remove all touches of this rally, then add them with Touch here" />
          </div>

          <div className="rr-play-row">
            <button className="seg-btn" onClick={playRally} title="Replay the rally">↻ Replay</button>
            <SpeedControl className="seg-btn" rate={speed} youtube={!player.current?.fileUrl()} onRate={pickSpeed} />
            {player.current?.fileUrl() && <FrameStep player={player} className="seg-btn" />}
            <button className={`seg-btn ${stepPause ? 'on' : ''}`} title="Pause briefly at each touch while the rally plays"
              onClick={() => { setStepPause(!stepPause); store('viq:stepPause', stepPause ? '0' : '1'); }}>Pause at touches</button>
            <button className={`seg-btn ${replay ? 'on' : ''}`} title="Opening a touch plays the 1.5 s before it (off = just show its frame)"
              onClick={() => { setReplay(!replay); store('viq:replayTouch', replay ? '0' : '1'); }}>Replay touch</button>
          </div>
          <div className="rr-serve-row">
            <span>Served by</span>
            <div className="segmented">
              <button className={serving === 'us' ? 'on' : ''} onClick={() => setServing('us')}>Us</button>
              <button className={serving === 'them' ? 'on' : ''} onClick={() => setServing('them')}>Them</button>
            </div>
          </div>

          {aiOn && player.current?.fileUrl() && (() => {
            const n = Math.min(16, r.events.filter((x) => x.t != null).length);
            const est = estimate(budget, n, 1, aiPrefs.examples());
            return (
              <button className="ai-run" disabled={!!aiBusy || n === 0} onClick={aiCheck}
                title="Three frames per touch go to the AI: real touch or not, whose, which action, which player">
                <span>{aiBusy ?? (answers.size ? 'Check this rally again' : 'AI check this rally')}</span>
                {!aiBusy && <small>{plural(n, 'touch')}{est.cost != null && budget ? ` · ≈ ${money(est.cost, budget.currency)}` : ''}{budget?.remaining != null ? ` · ${money(budget.remaining, budget.currency)} left` : ''}</small>}
              </button>
            );
          })()}
          {aiSummary && (
            <div className="ai-summary small">
              <span>AI: {aiSummary.text}</span>
              {aiSummary.undo && <button className="btn-ghost small" onClick={aiSummary.undo}>Undo AI</button>}
            </div>
          )}
          <div className="rotation-info">
            {rotation
              ? <>Setter in {setterPos || '?'} · {rotation.weServe ? 'we serve' : 'they serve'} · <button className="link" onClick={() => onLineup(r.set)}>line-up</button></>
              : <><button className="link" onClick={() => onLineup(r.set)}>Enter the line-up</button> to fill in servers and setters</>}
            {serving == null && <> · greyed = their touch</>}
          </div>
        </>}
      </div>

      {selected && sv && def && (isTheirs(selected) ? (
        <div className="touch-editor">
          <span className="small">This touch is counted as the other team's.</span>
          <div className="tool-row">
            <ToolBtn icon="✓" label="It's our touch" tone="primary" onClick={() => setTouchOwner(selected, 'us')} />
            <ToolBtn icon="⇄" label="Swap the whole rally" onClick={() => setServing(serving === 'us' ? 'them' : 'us')} />
            {r.events[0]?.id !== selected.id
              ? <ToolBtn icon="↳" label="New rally from here" tone="split" disabled={busy} onClick={() => splitAt(selected)} />
              : <span />}
            <ToolBtn icon="✕" label="Not a touch" tone="danger" onClick={() => removeChip(selected)} />
          </div>
        </div>
      ) : (
        <div className="touch-editor" ref={editor}>
          <div className="crumbs">
            <button className={step === 'player' ? 'on' : ''} onClick={() => setStep('player')}>{num(sv) || 'Who?'}</button>›
            <button className={step === 'action' ? 'on' : ''} onClick={() => setStep('action')}>{def.short}</button>
            {wantsSpots(sv.action, spots.location, spots.scope) && <>›<button className={step === 'from' || step === 'to' ? 'on' : ''}
              onClick={() => setStep(def.court === 'path' ? 'from' : 'to')}>Spot{sv.x != null ? ' ✓' : ''}</button></>}
            {answers.get(selected.id) && <span className="ai-note small">AI: {aiNote(answers.get(selected.id)!)}</span>}
          </div>
          <div className="tool-row five">
            <ToolBtn icon="◂" label="Back" disabled={!prevTouch(selected)} onClick={() => open(prevTouch(selected)!)} />
            {r.events[0]?.id !== selected.id
              ? <ToolBtn icon="↳" label="New rally from here" tone="split" disabled={busy} onClick={() => splitAt(selected)} title="A new rally starts with this touch" />
              : <span />}
            <ToolBtn icon="⇄" label="Their touch" onClick={() => setTouchOwner(selected, 'them')} title="Count this as the other team's touch" />
            <ToolBtn icon="✕" label="Not a touch" tone="danger" onClick={() => removeChip(selected)} />
            <ToolBtn icon="▸" label="Next" tone="primary" onClick={() => advance(selected)} title="Keep this touch as it is" />
          </div>

          {step === 'player' && (
            <div className="player-grid">
              {court.map(jersey)}
              {court.length > 0 && bench.length > 0 && <span className="grid-break" />}
              {(court.length ? bench : roster).map(jersey)}
            </div>
          )}

          {step === 'action' && (
            <ActionPicker value={sv.action} onPick={(c) => chooseAction(selected, c)} />
          )}

          {(step === 'from' || step === 'to') && (
            <SpotSheet
              title={`${num(sv) || '?'} ${def.short}`}
              prompt={(step === 'from' ? def.fromPrompt : def.toPrompt) ?? 'Where?'}
              step={def.court === 'path' ? (step === 'from' ? '1/2' : '2/2') : undefined}
              from={from} to={sv.x != null && sv.y != null ? { x: sv.x, y: sv.y } : null}
              flip={!!match.calibration && selected.t != null && ourHalfAt(match.calibration, selected.t) === 'far'}
              showTarget={sv.action === 'receive' && step === 'to'}
              net={isNetSpot(sv.action, step === 'from' || def.court !== 'path') ? { initial: def.court === 'path' ? from?.x : sv.x } : undefined}
              onPick={(p) => pickSpot(selected, p)}
              skipLabel={step === 'from' ? (from ? 'Keep start ▶' : 'Skip: not sure ▶') : sv.x != null ? 'Keep spot ▶' : 'Skip ▶'}
              onSkip={() => (step === 'from' ? setStep('to') : advance(selected))}
              onBack={() => setStep(step === 'to' && def.court === 'path' ? 'from' : 'action')}
              extra={sv.action === 'receive' ? (
                <div className="pad-grid pad-grid-4 receive-quick">
                  {[0, 1, 2, 3].map((g) => <button key={g} className={`act act-receive r${g}`} onClick={() => { patch(selected, { value: g }); advance(selected); }}>{g}</button>)}
                </div>
              ) : undefined}
            />
          )}

          {step === 'grade' && (
            <div className="pad-grid pad-grid-4 receive-quick">
              {[0, 1, 2, 3].map((g) => (
                <button key={g} className={`act act-receive r${g}`} onClick={() => { patch(selected, { value: g }); advance(selected); }}>{g}</button>
              ))}
            </div>
          )}
        </div>
      ))}

      <div className={`rally-actions ${!selected ? 'ready' : ''}`}>
        <button className="btn btn-won" disabled={busy} onClick={() => finish('won')}>We won <small>{outcomeText(true)}</small></button>
        <button className="btn btn-lost" disabled={busy} onClick={() => finish('lost')}>They won <small>{outcomeText(false)}</small></button>
        <button className="btn" disabled={busy} onClick={() => finish(null)}>✓ Save <small>no point</small></button>
        <button className="btn btn-danger" disabled={busy} onClick={notARally}>✕ <small>not a rally</small></button>
      </div>
      <div className="row between">
        {idx > 0
          ? <button className="btn-ghost small" onClick={() => setIdx((i) => Math.max(0, i - 1))}>◀ Rally</button>
          : <button className="btn-ghost small" disabled={busy || now == null} onClick={() => addAt(true)}
              title="No rally before this one: add one at the current video time">◀ + Rally{now != null ? ` at ${fmtTime(now)}` : ''}</button>}
        {last && <button className="btn-ghost small" disabled={busy} onClick={runUndo}>↶ Undo {last.text}</button>}
        <button className="btn-ghost small" disabled={idx >= rallies.length - 1} onClick={() => setIdx((i) => i + 1)}>Rally ▶</button>
      </div>
    </div>
  );
}

/** A labelled tool: an icon over a short text, big enough to hit and to see. */
function ToolBtn({ icon, label, sub, tone, ...rest }: { icon: string; label: string; sub?: string; tone?: 'split' | 'danger' | 'primary' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`tool-btn ${tone ?? ''}`} {...rest}>
      <span className="tool-ico" aria-hidden>{icon}</span>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}

/** The AI's answer for one touch, in a few words. */
function aiNote(a: AiTouch) {
  if (a.contact === 'no') return `AI: no touch (${Math.round(a.confidence * 100)}%)`;
  const pos = a.position && a.position !== 'unsure' ? `, ${a.position.replace('-', ' ')}` : '';
  return `AI: ${a.action}${a.jersey != null ? ` #${a.jersey}` : ''}${a.team === 'theirs' ? ', theirs' : a.team === 'ours' ? ', ours' : ''}${pos} (${Math.round(a.confidence * 100)}%)`;
}
