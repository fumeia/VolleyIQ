import { useState } from 'react';
import { ACTION_BY_CODE, ACTIONS, type ActionCode } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { fmtTime } from './TagPad';
import { courtFields } from '../lib/court';
import { CourtFull } from './CourtFull';
import { ActionPicker } from './ActionPicker';
import { ZoneCourt } from './ZoneCourt';

interface Props {
  event: VEvent;
  players: Player[];
  getTime?: () => number | null;
  onSave: (patch: Partial<VEvent>) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Bottom sheet for correcting a single event: player, action, grade, zone, time. */
export function EventEditor({ event, players, getTime, onSave, onDelete, onClose }: Props) {
  const [d, setD] = useState<Partial<VEvent>>({
    player_id: event.player_id, jersey: event.jersey, action: event.action,
    value: event.value, zone: event.zone, x: event.x, y: event.y, fx: event.fx, fy: event.fy, t: event.t,
  });
  const point = d.x != null && d.y != null ? { x: d.x, y: d.y } : null;
  const from = d.fx != null && d.fy != null ? { x: d.fx, y: d.fy } : null;
  const def = ACTION_BY_CODE[d.action!];
  // Which spot the next court tap sets.
  const [tapSets, setTapSets] = useState<'from' | 'to'>('to');
  const roster = players.filter((p) => p.active || p.id === event.player_id)
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const set = (patch: Partial<VEvent>) => setD((x) => ({ ...x, ...patch }));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <b>Edit event</b>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <label className="field-label">Player</label>
        <div className="chips">
          {roster.map((p) => (
            <button key={p.id} className={`chip ${d.player_id === p.id ? 'on' : ''}`}
              onClick={() => set({ player_id: p.id, jersey: p.number })}>
              #{p.number ?? '–'} {p.name.split(' ')[0]}
            </button>
          ))}
          <button className={`chip ${d.player_id == null ? 'on' : ''}`} onClick={() => set({ player_id: null })}>
            ? {d.player_id == null && d.jersey != null ? `#${d.jersey}` : 'Unknown'}
          </button>
        </div>

        <label className="field-label">Action</label>
        <ActionPicker value={d.action} onPick={(code) => set({ action: code, value: code === 'receive' ? d.value ?? 2 : null })} />
        <div className="chips tight">
          {ACTIONS.filter((a) => a.needsPlayer === false).map((a) => (
            <button key={a.code} className={`chip ${d.action === a.code ? 'on' : ''}`}
              onClick={() => set({ action: a.code as ActionCode, value: null })}>{a.label}</button>
          ))}
        </div>

        {d.action === 'receive' && (
          <>
            <label className="field-label">Receive grade</label>
            <div className="chips">
              {[0, 1, 2, 3].map((v) => (
                <button key={v} className={`chip ${d.value === v ? 'on' : ''}`} onClick={() => set({ value: v })}>{v}</button>
              ))}
            </div>
          </>
        )}

        <label className="field-label">
          Location {d.zone ? `(zone ${d.zone})` : ''}
          {(point || from || d.zone) && <button className="btn-ghost small" onClick={() => set({ x: null, y: null, fx: null, fy: null, zone: null })}>clear</button>}
        </label>
        {def?.court === 'path' && (
          <div className="segmented">
            <button className={tapSets === 'from' ? 'on' : ''} onClick={() => setTapSets('from')}>⚪ Played from</button>
            <button className={tapSets === 'to' ? 'on' : ''} onClick={() => setTapSets('to')}>🟠 Went to</button>
          </div>
        )}
        <div className="editor-court">
          <CourtFull sideways="auto"
            showTarget={d.action === 'receive'}
            from={from}
            to={point}
            onPick={(p) => {
              if (tapSets === 'from' && def?.court === 'path') {
                set({ ...courtFields(d.action!, p, point), value: d.value });
                setTapSets('to');
              } else set(courtFields(d.action!, from, p));
            }}
          />
        </div>
        {!point && <ZoneCourt compact selected={d.zone} onPick={(z) => set({ zone: d.zone === z ? null : z })} />}

        <label className="field-label">Video time: {fmtTime(d.t ?? null)}</label>
        <div className="chips">
          <button className="chip" onClick={() => set({ t: Math.max(0, (d.t ?? 0) - 1) })}>−1s</button>
          <button className="chip" onClick={() => set({ t: Math.max(0, (d.t ?? 0) - 0.2) })}>−0.2s</button>
          <button className="chip" onClick={() => set({ t: (d.t ?? 0) + 0.2 })}>+0.2s</button>
          <button className="chip" onClick={() => set({ t: (d.t ?? 0) + 1 })}>+1s</button>
          {getTime && <button className="chip" onClick={() => set({ t: getTime() })}>Use current</button>}
        </div>

        <div className="sheet-actions">
          <button className="btn btn-danger" onClick={onDelete}>Delete</button>
          <button className="btn btn-primary" onClick={() => onSave({ ...d, status: 'confirmed' })}>Save ✓</button>
        </div>
      </div>
    </div>
  );
}
