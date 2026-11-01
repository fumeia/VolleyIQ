import { useEffect, useMemo, useState } from 'react';
import { api, type Match, type Player, type VEvent } from '../lib/api';
import { detectionReport, MATCH_WINDOW, type DetectionRun } from '../lib/detectionReport';
import { pct, ratio } from './analysis/ui';

const SKILL_LABEL: Record<string, string> = { serve: 'Serves', receive: 'Passes', set: 'Sets', attack: 'Attacks', block: 'Blocks', dig: 'Digs', freeball: 'Free balls' };
const KIND_LABEL = { heard: 'Heard (a clear sound)', quiet: 'Quiet sound (guess)', gap: 'Gap in the rhythm (guess)' };

/**
 * How well a detection run did, measured against the touches saved for this match
 * (after reviewing it): found and missed touches, timing, actions and shirt numbers.
 */
export function DetectionReportCard({ match, players, confirmed }: { match: Match; players: Player[]; confirmed: VEvent[] }) {
  const [runs, setRuns] = useState<DetectionRun[] | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => { api.detectionRuns(match.id).then(setRuns).catch(() => setRuns([])); }, [match.id]);
  const run = runs?.find((r) => r.id === pick) ?? runs?.[0];
  const r = useMemo(() => (run ? detectionReport(run.events, confirmed, players) : null), [run, confirmed, players]);
  if (!runs?.length || !run || !r) return null;

  const share = (n: number, of: number) => `${pct(ratio(n, of))} (${n} of ${of})`;
  return (
    <details className="auto-step detection-report">
      <summary><b>How well did the detection do?</b> <small className="muted">{r.truth ? `found ${pct(ratio(r.found, r.truth))} of your touches` : 'review the match first'}</small></summary>
      {runs.length > 1 && (
        <select className="input" value={run.id} onChange={(e) => setPick(Number(e.target.value))}>
          {runs.map((x) => <option key={x.id} value={x.id}>Run of {new Date(`${x.created_at.replace(' ', 'T')}Z`).toLocaleString()} · {x.events.length} touches</option>)}
        </select>
      )}
      <p className="small muted">Measured against the touches you saved for this match (a detection within {MATCH_WINDOW} s of a saved touch counts as found). The more of the match you have reviewed, the more it says.
        {r.tagged.leftOut > 0 ? ` Only the tagged parts count: ${r.tagged.leftOut} detection${r.tagged.leftOut === 1 ? '' : 's'} in parts without tags are left out.` : ''}</p>
      {r.truth === 0 ? <p className="small">No saved touches in the part of the video this run covered yet.</p> : (
        <>
          <div className="kpis">
            <div className="kpi"><span className="kpi-label">Your touches found</span><span className="kpi-value">{pct(ratio(r.found, r.truth))}</span><span className="kpi-sub">{r.found} of {r.truth} · {r.truth - r.found} missed</span></div>
            <div className="kpi"><span className="kpi-label">Action right</span><span className="kpi-value">{pct(ratio(r.actions.right, r.actions.n))}</span><span className="kpi-sub">of the found touches</span></div>
            <div className="kpi"><span className="kpi-label">Shirt number right</span><span className="kpi-value">{r.numbers.read ? pct(ratio(r.numbers.right, r.numbers.read)) : '–'}</span><span className="kpi-sub">read on {share(r.numbers.read, r.found)}</span></div>
            <div className="kpi"><span className="kpi-label">Timing</span><span className="kpi-value">{r.timing.medianAbs != null ? `${r.timing.medianAbs.toFixed(2)} s` : '–'}</span><span className="kpi-sub">typical distance to your tag{r.timing.median != null ? ` (${r.timing.median > 0 ? 'late' : 'early'} on average)` : ''}</span></div>
          </div>
          <p className="small">Other detections: <b>{r.theirs}</b> probably the other team's touches, <b>{r.extra}</b> extra (noise, a touch heard twice, or a touch you did not tag).</p>
          <table className="small detection-table">
            <thead><tr><th>Your touches</th><th>Found</th></tr></thead>
            <tbody>{r.bySkill.map((s) => <tr key={s.skill}><td>{SKILL_LABEL[s.skill] ?? s.skill}</td><td>{share(s.found, s.n)}</td></tr>)}</tbody>
          </table>
          {r.actions.confusion.length > 0 && (
            <p className="small">Most common action mix-ups: {r.actions.confusion.map(([k, n]) => `${k} (${n})`).join(', ')}.</p>
          )}
          <table className="small detection-table">
            <thead><tr><th>Detections</th><th>Were your touches</th></tr></thead>
            <tbody>
              {r.byKind.map((k) => <tr key={k.kind}><td>{KIND_LABEL[k.kind]}</td><td>{share(k.hits, k.n)}</td></tr>)}
              {r.byConfidence.map((c) => <tr key={c.label}><td>Confidence {c.label}</td><td>{share(c.hits, c.n)}</td></tr>)}
            </tbody>
          </table>
          {run.params && <p className="small muted">Run settings: {Object.entries(run.params).map(([k, v]) => `${k} ${String(v)}`).join(' · ')}</p>}
        </>
      )}
    </details>
  );
}
