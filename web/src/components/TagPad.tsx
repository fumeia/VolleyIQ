import { useEffect, useRef, useState } from 'react';
import { ACTIONS, ACTION_BY_CODE, GROUPS, type ActionCode, type ActionDef } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { ZoneCourt } from './ZoneCourt';

export interface TagSettings {
  autoPause: boolean;   // pause the video while a tag is being entered
  askZone: boolean;     // ask for a zone after attacks/serves
  leadSeconds: number;  // shift the timestamp back (reaction time)
}

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
 * Two-tap tagging for touch screens: tap the jersey, tap the action (and
 * optionally a zone). The video pauses on the first tap and resumes once the
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

  function finish(d: Draft, zone: number | null) {
    if (!d.action) return;
    onCommit({
      player_id: d.player?.id ?? null,
      jersey: d.player?.number ?? null,
      action: d.action.code,
      value: d.value ?? null,
      zone,
      t: d.t,
    });
    setDraft(null);
    if (d.resume) play?.();
  }

  function chooseAction(action: ActionDef, value?: number) {
    const d = draftRef.current ?? { player: null, t: getTime(), resume: false };
    const next = { ...d, action, value };
    if (settings.askZone && action.zone) setDraft(next);
    else finish(next, null);
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
        if (z >= 1 && z <= 6) finish(draftRef.current, z);
        else if (e.key === 'Enter') finish(draftRef.current, null);
        return;
      }
      if (/^[0-3]$/.test(e.key)) return chooseAction(ACTION_BY_CODE.receive, Number(e.key));
      const a = ACTIONS.find((x) => x.key === e.key.toLowerCase());
      if (a) chooseAction(a);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (draft?.action) {
    return (
      <div className="pad">
        <div className="pad-head">
          <span>{who(draft.player)} · <b>{draft.action.label}</b> → zone?</span>
          <button className="btn-ghost" onClick={cancel}>Cancel</button>
        </div>
        <ZoneCourt onPick={(z) => finish(draft, z)} />
        <button className="btn wide" onClick={() => finish(draft, null)}>No zone</button>
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
          <div className="pad-grid pad-grid-4">
            {[0, 1, 2, 3].map((v) => (
              <button key={v} className={`act act-receive r${v}`} onClick={() => chooseAction(ACTION_BY_CODE.receive, v)}>
                {v}
              </button>
            ))}
          </div>
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
