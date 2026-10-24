import { useEffect, useRef, useState } from 'react';
import { ACTIONS, ACTION_BY_CODE, GROUPS, type ActionCode, type ActionDef } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { receiveGrade, zoneOf, type Pt } from '../lib/court';
import { CourtHalf } from './CourtHalf';
import { ZoneCourt } from './ZoneCourt';

export interface TagSettings {
  autoPause: boolean;                     // pause the video while a tag is being entered
  location: 'points' | 'zones' | 'off';   // how to record where attacks/serves landed
  receiveMode: 'court' | 'grade';         // tap where the pass landed, or grade 0-3 directly
  leadSeconds: number;                    // shift the timestamp back (reaction time)
}

export const DEFAULT_TAG_SETTINGS: TagSettings = { autoPause: true, location: 'points', receiveMode: 'court', leadSeconds: 1 };

interface Props {
  players: Player[];
  settings: TagSettings;
  getTime: () => number | null;
  pause?: () => void;
  play?: () => void;
  isPlaying?: () => boolean;
  onCommit: (e: Partial<VEvent>) => void;
}

interface Draft {
  player: Player | null;
  t: number | null;
  action?: ActionDef;
  value?: number;
  resume: boolean;
}

/**
 * Two-tap tagging for touch screens: tap the jersey, tap the action, then tap
 * where the ball went. The video pauses on the first tap and resumes once the
 * tag is stored, so no keyboard and no separate pause button is needed.
 */
export function TagPad({ players, settings, getTime, pause, play, isPlaying, onCommit }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const roster = players.filter((p) => p.active).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));

  function start(player: Player | null) {
    const t = getTime();
    const wasPlaying = !!isPlaying?.();
    if (settings.autoPause && wasPlaying) pause?.();
    setDraft({ player, t: t == null ? null : Math.max(0, t - settings.leadSeconds), resume: settings.autoPause && wasPlaying });
  }

  function finish(d: Draft, where: { zone?: number | null; point?: Pt | null } = {}) {
    if (!d.action) return;
    const point = where.point ?? null;
    let value = d.value ?? null;
    if (d.action.code === 'receive' && point && value == null) value = receiveGrade(point);
    onCommit({
      player_id: d.player?.id ?? null,
      jersey: d.player?.number ?? null,
      action: d.action.code,
      value,
      zone: point ? zoneOf(point) : where.zone ?? null,
      x: point?.x ?? null,
      y: point?.y ?? null,
      t: d.t,
    });
    setDraft(null);
    if (d.resume) play?.();
  }

  function chooseAction(action: ActionDef, value?: number) {
    const d = draftRef.current ?? { player: null, t: getTime(), resume: false };
    const next = { ...d, action, value };
    const wantsLocation = action.code === 'receive'
      ? settings.receiveMode === 'court' && value == null
      : !!action.zone && settings.location !== 'off';
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

  if (draft?.action?.code === 'receive') {
    return (
      <div className="pad">
        <div className="pad-head">
          <span>{who(draft.player)} · <b>Receive</b> → where did the pass go?</span>
          <button className="btn-ghost" onClick={cancel}>Cancel</button>
        </div>
        <div className="pad-grid pad-grid-4 receive-quick">
          {[0, 1, 2, 3].map((v) => (
            <button key={v} className={`act act-receive r${v}`} onClick={() => finish({ ...draft, value: v })}>{v}</button>
          ))}
        </div>
        <span className="muted small">Tap the court (circle = perfect pass, grade is set from the distance) or just pick a grade above.</span>
        <CourtHalf half="ours" showTarget onPick={(p) => finish(draft, { point: p })} label="Tap where the pass landed" />
      </div>
    );
  }

  if (draft?.action) {
    return (
      <div className="pad">
        <div className="pad-head">
          <span>{who(draft.player)} · <b>{draft.action.label}</b> → where?</span>
          <button className="btn-ghost" onClick={cancel}>Cancel</button>
        </div>
        {settings.location === 'points'
          ? <CourtHalf half="theirs" onPick={(p) => finish(draft, { point: p })} label="Tap where the ball landed" />
          : <ZoneCourt onPick={(z) => finish(draft, { zone: z })} />}
        <button className="btn wide" onClick={() => finish(draft)}>No location</button>
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
        <div className="pad-receive">
          <span className="pad-group-label g-receive">Receive</span>
          {settings.receiveMode === 'court' ? (
            <button className="act act-receive wide" onClick={() => chooseAction(ACTION_BY_CODE.receive)}>Receive → tap on court</button>
          ) : (
            <div className="pad-grid pad-grid-4">
              {[0, 1, 2, 3].map((v) => (
                <button key={v} className={`act act-receive r${v}`} onClick={() => chooseAction(ACTION_BY_CODE.receive, v)}>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
        {GROUPS.map((g) => (
          <div key={g.id} className="pad-group">
            <span className={`pad-group-label g-${g.id}`}>{g.label}</span>
            <div className="pad-grid">
              {ACTIONS.filter((a) => a.group === g.id).map((a) => (
                <button key={a.code} className={`act act-${g.id}`} onClick={() => chooseAction(a)}>
                  {a.label}
                  {a.key && <kbd>{a.key.toUpperCase()}</kbd>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pad">
      <div className="pad-head"><span className="muted">Tap the player who touched the ball</span></div>
      <div className="pad-grid pad-players">
        {roster.map((p) => (
          <button key={p.id} className={`jersey role-${p.role}`} onClick={() => start(p)}>
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
