import { useEffect, useRef, useState } from 'react';
import { api, type MatchSheet, type SheetPlayer, type Team } from '../lib/api';
import { ROLES, type RoleCode } from '../lib/actions';
import { replaySet, type MatchSheetFlow } from '../lib/sheetFlow';

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

/** Same club, ignoring case, punctuation and team suffixes ("Volley Nord H2" ~ "volley nord"). */
const sameTeam = (a: string, b: string) => {
  const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9äöüéèà]+/g, ' ').trim();
  const x = n(a), y = n(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/**
 * Scan an official match sheet photo and pre-fill a match: tap a team to set it
 * as the opponent (with the date and league), or turn a roster into a team.
 */
export function MatchSheetScan({ onPick, onTeamCreated, onAttach }: {
  /** New match: this team is the opponent (so the other one is ours, with the match flow). */
  onPick?: (v: { opponent: string; date: string | null; label: string; flow: MatchSheetFlow | null; liberoNo: number | null }) => void;
  onTeamCreated: (teamId: number) => void;
  /** Existing match: this team is ours; keep the sheet's match flow with the match. */
  onAttach?: (flow: MatchSheetFlow, liberoNo: number | null) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<MatchSheet | null>(null);
  const [created, setCreated] = useState<Record<'A' | 'B', string | null>>({ A: null, B: null });
  const [teams, setTeams] = useState<Team[]>([]);
  const [target, setTarget] = useState<Record<'A' | 'B', number | ''>>({ A: '', B: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.matchsheetEnabled().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false)); }, []);
  useEffect(() => { api.teams().then(setTeams).catch(() => {}); }, []);

  if (enabled === false || enabled === null) return null; // hidden unless the server has it set up

  async function scan(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(''); setSheet(null); setCreated({ A: null, B: null });
    try {
      const images = await Promise.all([...files].slice(0, 4).map(toBase64));
      const { data } = await api.scanMatchsheet(images);
      setSheet(data);
      // An existing team with the same name: update it rather than creating a second one.
      const match = (side: 'A' | 'B') => teams.find((t) => data.teams[side] && sameTeam(t.name, data.teams[side]!))?.id ?? '';
      setTarget({ A: match('A'), B: match('B') });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** The sheet's match flow with [ours] as our team (null when the grids were not read). */
  const flowFor = (s: MatchSheet, ours: 'A' | 'B'): MatchSheetFlow | null =>
    s.flow?.length ? { ourTeam: ours, sets: s.sets.map((x) => ({ a: x.a, b: x.b })), flow: s.flow } : null;
  const liberoOf = (s: MatchSheet, side: 'A' | 'B') => s.rosters[side].find((p) => p.libero)?.number ?? null;
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
      setCreated((c) => ({ ...c, [side]: '✓ team created' }));
      onTeamCreated(team.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the team');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Bring an existing team up to date with the sheet, matched by jersey number: players
   * already there keep their name and role (and come back if they were removed); only
   * numbers that are new get added.
   */
  async function updateTeam(side: 'A' | 'B', s: MatchSheet, teamId: number) {
    setBusy(true);
    try {
      const team = await api.team(teamId);
      let kept = 0, added = 0, back = 0;
      for (const p of s.rosters[side]) {
        const have = p.number == null ? undefined : team.players.find((x) => x.number === p.number);
        if (have) {
          kept++;
          if (!have.active) { await api.updatePlayer(have.id, { active: 1 }); back++; }
        } else {
          await api.addPlayer(teamId, { name: p.name, number: p.number ?? undefined, role: toRole(p.role, p.libero) });
          added++;
        }
      }
      setCreated((c) => ({ ...c, [side]: `✓ ${kept} kept${back ? ` (${back} back)` : ''}, ${added} added` }));
      onTeamCreated(teamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the team');
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
          {onPick && (
            <button type="button" className="btn-ghost small" onClick={() => { const ours = side === 'A' ? 'B' : 'A'; onPick({ opponent: name, date: s.date, label: label(s), flow: flowFor(s, ours), liberoNo: liberoOf(s, ours) }); }}>
              Use <b>{name}</b> as opponent
            </button>
          )}
          {onAttach && flowFor(s, side) && (
            <button type="button" className="btn-ghost small" onClick={() => onAttach(flowFor(s, side)!, liberoOf(s, side))}>
              We are <b>{name}</b>: keep the match flow
            </button>
          )}
        </div>
        {roster.length > 0 && (created[side] ? <span className="muted small">{created[side]}</span> : (
          <div className="row wrap">
            <select className="input slim" value={target[side]} onChange={(e) => setTarget((t) => ({ ...t, [side]: e.target.value ? Number(e.target.value) : '' }))}>
              <option value="">New team</option>
              {teams.map((t) => <option key={t.id} value={t.id}>Update {t.name}</option>)}
            </select>
            {target[side] === ''
              ? <button type="button" className="btn small" disabled={busy} onClick={() => createTeam(side, s)}>Create team ({roster.length})</button>
              : <button type="button" className="btn small" disabled={busy} onClick={() => updateTeam(side, s, target[side] as number)}
                  title="Players are matched by jersey number: existing names and roles are kept, new numbers are added">Update roster</button>}
          </div>
        ))}
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
      <p className="muted small">Photograph the official sheet to fill in the teams, date and rosters. Check the result: handwriting can be misread.</p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => scan(e.target.files)} />
      {error && <p className="error small">{error}</p>}
      {sheet && (
        <div className="sheet-result">
          {sheet.confidence === 'low' && <p className="muted small">⚠ Low confidence: double-check everything.</p>}
          {(sheet.date || sheet.venue) && <p className="muted small">{[sheet.date, sheet.venue, sheet.time].filter(Boolean).join(' · ')}</p>}
          {sheet.sets.length > 0 && (
            <p className="small">Result: {sheet.winner && sheet.setsWon ? `${sheet.setsWon.A}–${sheet.setsWon.B} · ` : ''}
              {sheet.sets.map((x, i) => <span key={i} className="set-chip">{x.a}–{x.b}</span>)}</p>
          )}
          {sheet.flow?.length ? (
            <p className="small">Match flow: {sheet.flow.map((f) => {
              const fin = sheet.sets[f.set - 1];
              const r = fin ? replaySet(f, fin) : null;
              const ok = !!r?.ok;
              return <span key={f.set} className={`set-chip ${ok ? '' : 'bad'}`} title={ok ? 'Service rounds add up to the set score' : `Does not add up (probably a misread cell): ${r?.issues.map((x) => x.text).join('; ') ?? 'no final score'}. The rotation stats leave this set out; the tag check still uses it.`}>Set {f.set} {ok ? '✓' : '✗'}</span>;
            })}</p>
          ) : null}
          {teamBlock('A', sheet)}
          {teamBlock('B', sheet)}
        </div>
      )}
    </div>
  );
}
