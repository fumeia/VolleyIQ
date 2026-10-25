import { useEffect, useRef, useState } from 'react';
import { ACTIONS, ACTION_BY_CODE, SHORT, SKILLS, wantsSpots, type ActionCode, type ActionDef } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { courtFields, receiveGrade, type Pt } from '../lib/court';
import { CourtFull } from './CourtFull';
import { ZoneCourt } from './ZoneCourt';

export interface TagSettings {
  autoPause: boolean;                     // pause the video while a tag is being entered
  location: 'points' | 'zones' | 'off';   // how to record court spots (attacks, serves, digs, blocks)
  fromTap: boolean;                       // with points: also tap where the ball was played from
  spotScope: 'all' | 'key';               // court spots for every action, or only serves, passes and attacks
  receiveMode: 'court' | 'grade';         // tap where the pass landed, or grade 0-3 directly
  leadSeconds: number;                    // shift the timestamp back (reaction time)
}

export const DEFAULT_TAG_SETTINGS: TagSettings = { autoPause: true, location: 'points', fromTap: true, spotScope: 'all', receiveMode: 'court', leadSeconds: 1 };

interface Props {
  players: Player[];
  settings: TagSettings;
  getTime: () => number | null;
  pause?: () => void;
  play?: () => void;
  isPlaying?: () => boolean;
  onCommit: (e: Partial<VEvent>) => void;
  /** Player ids on court (from the line-up and rotation), shown first. */
  onCourt?: number[];
  /** Our server when we serve (from the rotation): one tap starts the serve. */
  server?: Player | null;
  /** The previous tag of this rally: the likely next actions come first. */
  lastAction?: ActionCode | null;
}

/** What usually follows a touch of ours, for the "likely" row. */
const NEXT: Partial<Record<ActionCode | 'start', ActionCode[]>> = {
  start: ['serve', 'receive', 'dig'],
  serve: ['dig', 'block_touch', 'freeball'],
  receive: ['set', 'attack', 'freeball'],
  dig: ['set', 'attack', 'freeball'],
  freeball: ['set', 'attack'],
  set: ['attack', 'kill', 'attack_error'],
  assist: ['dig', 'block_touch'],
  attack: ['dig', 'block_touch', 'set'],
  block_touch: ['dig', 'set'],
};

interface Draft {
  player: Player | null;
  t: number | null;
  action?: ActionDef;
  value?: number;
  /** Which court tap comes next, and where the ball was played from once tapped. */
  stage?: 'from' | 'to';
  from?: Pt | null;
  resume: boolean;
}

/**
 * Two-tap tagging for touch screens: tap the jersey, tap the action, then tap
 * where the ball went. The video pauses on the first tap and resumes once the
 * tag is stored, so no keyboard and no separate pause button is needed.
 */
export function TagPad({ players, settings, getTime, pause, play, isPlaying, onCommit, onCourt, server, lastAction }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const rank = (id: number) => { const i = onCourt?.indexOf(id) ?? -1; return i < 0 ? 99 : i; };
  const roster = players.filter((p) => p.active).sort((a, b) => rank(a.id) - rank(b.id) || (a.number ?? 999) - (b.number ?? 999));

  function begin(player: Player | null): Draft {
    const t = getTime();
    const wasPlaying = !!isPlaying?.();
    if (settings.autoPause && wasPlaying) pause?.();
    return { player, t: t == null ? null : Math.max(0, t - settings.leadSeconds), resume: settings.autoPause && wasPlaying };
  }

  function start(player: Player | null) {
    setDraft(begin(player));
  }

  function finish(d: Draft, where: { zone?: number | null; point?: Pt | null } = {}) {
    if (!d.action) return;
    const point = where.point ?? null;
    const spots = courtFields(d.action.code, d.from ?? null, point);
    let value = d.value ?? null;
    if (d.action.code === 'receive' && point && value == null) value = receiveGrade(point);
    onCommit({
      player_id: d.player?.id ?? null,
      jersey: d.player?.number ?? null,
      action: d.action.code,
      ...spots,
      value,
      zone: spots.zone ?? where.zone ?? null,
      t: d.t,
    });
    setDraft(null);
    if (d.resume) play?.();
  }

  function chooseAction(action: ActionDef, value?: number, base?: Draft) {
    const d = base ?? draftRef.current ?? { player: null, t: getTime(), resume: false };
    const askFrom = action.court === 'path' && settings.location === 'points' && settings.fromTap;
    const next: Draft = { ...d, action, value, stage: askFrom ? 'from' : 'to', from: null };
    const wantsLocation = action.code === 'receive'
      ? settings.receiveMode === 'court' && value == null
      : wantsSpots(action.code, settings.location, settings.spotScope);
    if (wantsLocation) setDraft(next);
    else finish(next);
  }

  function teamAction(code: ActionCode) {
    const t = getTime();
    onCommit({ action: code, t: t == null ? null : Math.max(0, t - settings.leadSeconds) });
  }

  function cancel() {
    const d = draftRef.current;
    setDraft(null);
    if (d?.resume) play?.();
  }

  // Desktop keyboard: same letter layout as VolleyTag (Q/W/E/R, A/S/D/F, Z/X/V, T/Y, 0-3).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!draftRef.current || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') return cancel();
      if (draftRef.current.action) {
        const z = Number(e.key);
        if (draftRef.current.action.code === 'receive' && z >= 0 && z <= 3) finish({ ...draftRef.current, value: z });
        else if (z >= 1 && z <= 6) finish(draftRef.current, { zone: z });
        else if (e.key === 'Enter') finish(draftRef.current);
        return;
      }
      if (/^[0-3]$/.test(e.key)) return chooseAction(ACTION_BY_CODE.receive, Number(e.key));
      const a = ACTIONS.find((x) => x.key === e.key.toLowerCase());
      if (a) chooseAction(a);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const likely = (NEXT[lastAction ?? 'start'] ?? []).filter((c) => ACTION_BY_CODE[c]);

  if (draft?.action && settings.location === 'zones' && draft.action.code !== 'receive') {
    return (
      <div className="pad">
        <div className="pad-head">
          <span>{who(draft.player)} · <b>{draft.action.label}</b> → zone?</span>
          <button className="btn-ghost" onClick={cancel}>Cancel</button>
        </div>
        <ZoneCourt onPick={(z) => finish(draft, { zone: z })} />
        <button className="btn wide" onClick={() => finish(draft)}>No location</button>
      </div>
    );
  }

  if (draft?.action) {
    const a = draft.action;
    const first = draft.stage === 'from';
    const prompt = (first ? a.fromPrompt : a.toPrompt) ?? 'Where?';
    const steps = a.court === 'path' && settings.fromTap ? ` (${first ? 1 : 2}/2)` : '';
    return (
      <div className="pad">
        <div className="pad-head">
          <span>{who(draft.player)} · <b>{a.label}</b> → {prompt}{steps}</span>
          <button className="btn-ghost" onClick={cancel}>Cancel</button>
        </div>
        {a.code === 'receive' && (
          <div className="pad-grid pad-grid-4 receive-quick">
            {[0, 1, 2, 3].map((v) => (
              <button key={v} className={`act act-receive r${v}`} onClick={() => finish({ ...draft, value: v })}>{v}</button>
            ))}
          </div>
        )}
        <CourtFull sideways="auto" label={prompt} from={draft.from} showTarget={a.code === 'receive' && !first}
          onPick={(p) => (first ? setDraft({ ...draft, from: p, stage: 'to' }) : finish(draft, { point: p }))} />
        <button className="btn wide" onClick={() => (first ? setDraft({ ...draft, stage: 'to' }) : finish(draft))}>
          {first ? 'Skip: not sure where from' : 'Skip: no landing spot'}
        </button>
      </div>
    );
  }

  if (draft) {
    return (
      <div className="pad">
        <div className="pad-head">
          <span><b>{who(draft.player)}</b> {draft.t != null && <small className="muted">@ {fmtTime(draft.t)}</small>}</span>
          <button className="btn-ghost" onClick={cancel}>Cancel</button>
        </div>
        {likely.length > 0 && (
          <div className="pad-likely">
            {likely.map((code) => (
              <button key={code} className={`act act-${ACTION_BY_CODE[code].group}`} onClick={() => chooseAction(ACTION_BY_CODE[code])}>
                {ACTION_BY_CODE[code].label}
              </button>
            ))}
          </div>
        )}
        {SKILLS.map((row) => (
          <div key={row.label} className="skill-row">
            <span className="skill-label">{row.label}</span>
            {row.label === 'Pass' && settings.receiveMode !== 'court'
              ? [0, 1, 2, 3].map((v) => (
                <button key={v} className={`act act-receive r${v}`} onClick={() => chooseAction(ACTION_BY_CODE.receive, v)}>{v}</button>
              ))
              : row.codes.map((code) => {
                const a = ACTION_BY_CODE[code];
                const tone = a.score === 'us' ? 'points' : a.score === 'them' ? 'errors' : code === 'receive' ? 'receive' : 'actions';
                return (
                  <button key={code} className={`act act-${tone}`} onClick={() => chooseAction(a)}>
                    {SHORT[code] ?? a.short}
                    {a.key && <kbd>{a.key.toUpperCase()}</kbd>}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pad">
      <div className="pad-head"><span className="muted">Tap the player who touched the ball</span></div>
      {server && (
        <button className="act act-actions wide serve-now" onClick={() => chooseAction(ACTION_BY_CODE.serve, undefined, begin(server))}>
          Serve · #{server.number ?? '–'} {server.name.split(' ')[0]}
        </button>
      )}
      <div className="pad-grid pad-players">
        {roster.map((p) => (
          <button key={p.id} className={`jersey role-${p.role} ${onCourt?.length && !onCourt.includes(p.id) ? 'bench' : ''}`} onClick={() => start(p)}>
            <span className="jersey-num">{p.number ?? '–'}</span>
            <span className="jersey-name">{p.name.split(' ')[0]}</span>
            <span className="jersey-role">{p.role}</span>
          </button>
        ))}
        <button className="jersey jersey-unknown" onClick={() => start(null)}>
          <span className="jersey-num">?</span>
          <span className="jersey-name">Unknown</span>
        </button>
      </div>
      {roster.length === 0 && <p className="muted small">No roster yet: add players to the team to tag per player.</p>}
      <div className="pad-team">
        <button className="act act-points" onClick={() => teamAction('opp_error')}>+1 Opp. error</button>
        <button className="act act-errors" onClick={() => teamAction('opp_point')}>+1 Opp. point</button>
      </div>
    </div>
  );
}

const who = (p: Player | null) => (p ? `#${p.number ?? '?'} ${p.name}` : 'Unknown player');

export function fmtTime(t: number | null) {
  if (t == null) return '–';
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
