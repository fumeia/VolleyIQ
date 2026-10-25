import { useEffect, useRef, useState } from 'react';
import { api, type MatchSheet, type SheetPlayer } from '../lib/api';
import { ROLES, type RoleCode } from '../lib/actions';

/** Map a role word off the sheet (de/fr/en or a code) to our role codes. */
function toRole(s: string | null | undefined, libero: boolean): RoleCode {
  if (libero) return 'L';
  const w = (s ?? '').toLowerCase();
  if (/zuspiel|passeur|setter|^s$|steller/.test(w)) return 'S';
  if (/mitte|middle|zentral|^mb$|^m$/.test(w)) return 'MB';
  if (/dia|oppos|^opp$/.test(w)) return 'OPP';
  if (/libero|^l$/.test(w)) return 'L';
  if (ROLES.some((r) => r.code === w.toUpperCase())) return w.toUpperCase() as RoleCode;
  return 'OH';
}

async function toBase64(file: File): Promise<{ media_type: string; data: string }> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { media_type: file.type || 'image/jpeg', data: btoa(bin) };
}

/**
 * Scan an official match sheet photo and pre-fill a match: tap a team to set it
 * as the opponent (with the date and league), or turn a roster into a team.
 */
export function MatchSheetScan({ onPick, onTeamCreated }: {
  onPick: (v: { opponent: string; date: string | null; label: string }) => void;
  onTeamCreated: (teamId: number) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<MatchSheet | null>(null);
  const [created, setCreated] = useState<Record<'A' | 'B', number | null>>({ A: null, B: null });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.matchsheetEnabled().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false)); }, []);

  if (enabled === false || enabled === null) return null; // hidden unless the server has it set up

  async function scan(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(''); setSheet(null); setCreated({ A: null, B: null });
    try {
      const images = await Promise.all([...files].slice(0, 4).map(toBase64));
      const { data } = await api.scanMatchsheet(images);
      setSheet(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const label = (s: MatchSheet) => [s.league && `${s.league}`, s.matchNo && `#${s.matchNo}`].filter(Boolean).join(' · ');

  async function createTeam(side: 'A' | 'B', s: MatchSheet) {
    const name = s.teams[side];
    const roster = s.rosters[side];
    if (!name || !roster.length) return;
    setBusy(true);
    try {
      const team = await api.createTeam(name);
      for (const p of roster) {
        await api.addPlayer(team.id, { name: p.name, number: p.number ?? undefined, role: toRole(p.role, p.libero) });
      }
      setCreated((c) => ({ ...c, [side]: team.id }));
      onTeamCreated(team.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the team');
    } finally {
      setBusy(false);
    }
  }

  const teamBlock = (side: 'A' | 'B', s: MatchSheet) => {
    const name = s.teams[side];
    const roster = s.rosters[side];
    if (!name) return null;
    return (
      <div className="sheet-team">
        <div className="row between">
          <button type="button" className="btn-ghost small" onClick={() => onPick({ opponent: name, date: s.date, label: label(s) })}>
            Use <b>{name}</b> as opponent
          </button>
          {roster.length > 0 && (created[side]
            ? <span className="muted small">✓ team created</span>
            : <button type="button" className="btn small" disabled={busy} onClick={() => createTeam(side, s)}>Create team ({roster.length})</button>)}
        </div>
        {roster.length > 0 && (
          <ul className="sheet-roster">
            {roster.map((p: SheetPlayer, i) => (
              <li key={i}><span className="num">{p.number ?? '–'}</span> {p.name}{p.captain ? ' (C)' : ''}{p.libero ? ' · L' : ''}</li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="sheet-scan card">
      <div className="row between">
        <b>📸 Scan match sheet</b>
        <button type="button" className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Reading…' : sheet ? 'Rescan' : 'Take / pick photo'}
        </button>
      </div>
      <p className="muted small">Photograph the official sheet to fill in the teams, date and rosters. Check the result — handwriting can misread.</p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => scan(e.target.files)} />
      {error && <p className="error small">{error}</p>}
      {sheet && (
        <div className="sheet-result">
          {sheet.confidence === 'low' && <p className="muted small">⚠ Low confidence — double-check everything.</p>}
          {(sheet.date || sheet.venue) && <p className="muted small">{[sheet.date, sheet.venue, sheet.time].filter(Boolean).join(' · ')}</p>}
          {sheet.sets.length > 0 && (
            <p className="small">Result: {sheet.winner && sheet.setsWon ? `${sheet.setsWon.A}–${sheet.setsWon.B} · ` : ''}
              {sheet.sets.map((x, i) => <span key={i} className="set-chip">{x.a}–{x.b}</span>)}</p>
          )}
          {teamBlock('A', sheet)}
          {teamBlock('B', sheet)}
        </div>
      )}
    </div>
  );
}
