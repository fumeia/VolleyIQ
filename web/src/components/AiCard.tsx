import { useEffect, useRef, useState } from 'react';
import { api, serverBase, type AiBudget, type AiField, type AiStats, type Match, type Player, type VEvent } from '../lib/api';
import { ourHalfAt } from '../lib/calibration';
import { isApp, Native, type WorkState } from '../lib/native';
import { aiPrefs, checkAll, estimate, money, touchesToCheck } from '../lib/aiCheck';
import { TRUST_AFTER, trustFor } from '../lib/aiTrust';
import { groupRallies } from '../lib/rallyReview';
import { plural } from './analysis/ui';
import { Sparkles } from 'lucide-react';

interface Props {
  match: Match;
  players: Player[];
  suggested: VEvent[];
  /** The video file in the player (the AI check reads its frames), or null. */
  fileUrl: () => string | null;
  /** In the Android app: the video on the phone; the check then runs as a background job. */
  localUri?: string | null;
  reload: () => Promise<unknown>;
  /** Asked to check every rally (after the detection, when that option is on); done() when finished. */
  autoRun?: { done: () => void } | null;
}

const FIELDS: { field: AiField; label: string }[] = [
  { field: 'contact', label: 'Noise: not a touch' },
  { field: 'team', label: 'Ours or theirs' },
  { field: 'action', label: 'Action' },
  { field: 'jersey', label: 'Player by shirt number' },
  { field: 'position', label: 'Player by court position' },
];

/**
 * The AI check before a run: what it does (and how well it has done so far), the
 * options, the credit left and whether checking every rally fits in it.
 */
export function AiCard({ match, players, suggested, fileUrl, localUri, reload, autoRun }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [budget, setBudget] = useState<AiBudget | null>(null);
  const [stats, setStats] = useState<{ fields: AiStats; examples: number } | null>(null);
  const [afterDetect, setAfterDetect] = useState(aiPrefs.afterDetect);
  const [examples, setExamples] = useState(aiPrefs.examples);
  const [run, setRun] = useState<{ done: number; total: number; note?: string } | null>(null);
  const stop = useRef(false);
  // The background job in the app (goes on when you switch apps), followed while this is open.
  const native = isApp() && !!localUri;
  const [job, setJob] = useState<WorkState | null>(null);
  const after = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!native) return;
    let live = true, was: string | null = null;
    const tick = async () => {
      const w = (await Native.aiCheckStatus({ matchId: match.id }).catch(() => null))?.work ?? null;
      if (!live) return;
      setJob(w);
      // Finished while we watched: show the answers and go on.
      if (w && was && ['enqueued', 'running'].includes(was) && ['succeeded', 'failed', 'cancelled'].includes(w.state)) {
        await reload();
        api.aiBudget().then(setBudget).catch(() => {});
        after.current?.();
        after.current = null;
      }
      was = w?.state ?? null;
    };
    tick();
    const t = window.setInterval(tick, 1500);
    return () => { live = false; clearInterval(t); };
  }, [native, match.id]);
  const jobRunning = !!job && ['enqueued', 'running', 'blocked'].includes(job.state);

  useEffect(() => {
    api.touchCheckEnabled().then((x) => {
      setEnabled(x.enabled);
      if (!x.enabled) return;
      api.aiBudget().then(setBudget).catch(() => {});
      api.aiStats().then(setStats).catch(() => {});
    }).catch(() => setEnabled(false));
  }, []);

  const { rallies } = groupRallies(suggested, match.calibration);
  const todo = rallies.filter((r) => r.events.some((e) => e.t != null && !e.ai));
  const touches = touchesToCheck(rallies);
  const est = estimate(budget, touches, todo.length, examples);
  const url = fileUrl();

  async function checkEverything(then?: () => void) {
    if (native) {
      await Native.requestNotifications().catch(() => {});
      after.current = then ?? null;
      await Native.aiCheckAll({
        matchId: match.id,
        job: JSON.stringify({
          matchId: match.id, apiBase: serverBase(), token: api.token(), uri: localUri, examples,
          roster: players.filter((p) => p.active && p.number != null).map((p) => ({ number: p.number, role: p.role })),
          rallies: todo.map((r) => {
            const half = match.calibration ? ourHalfAt(match.calibration, r.start) : null;
            return { ourSide: half === 'near' || half === 'far' ? half : null, touches: r.events.filter((e) => e.t != null).slice(0, 16).map((e) => ({ id: e.id, t: e.t })) };
          }),
        }),
      });
      setJob({ id: '', state: 'enqueued', progress: 0, message: 'Starting…' });
      return;
    }
    const u = fileUrl();
    if (!u || run) return;
    stop.current = false;
    setRun({ done: 0, total: todo.length });
    try {
      await checkAll(rallies, { match, players, url: u, examples }, (done, total, note) => setRun({ done, total, note }), () => stop.current);
      await reload();
    } finally {
      api.aiBudget().then(setBudget).catch(() => {});
      setRun((r) => (r?.note ? r : null));
      then?.();
    }
  }

  // Started by the detection finishing (with "check every rally" on).
  const started = useRef<unknown>(null);
  useEffect(() => {
    if (!autoRun || started.current === autoRun || !enabled) return;
    started.current = autoRun;
    if ((!native && !fileUrl()) || !todo.length) { autoRun.done(); return; }
    checkEverything(autoRun.done);
  }, [autoRun, enabled, suggested]);

  if (!enabled) return null;
  const cur = budget?.currency ?? '$';
  const resets = budget?.resetAt ? new Date(budget.resetAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;

  return (
    <div className="auto-step ai-card">
      <b className="row"><Sparkles /> AI check <small className="muted">(optional, uses AI credit)</small></b>
      <span className="small muted">Three frames per detected touch go to the AI model on your server's account. It marks noise, sorts ours / theirs and fills in actions and players before you review.</span>

      <div className="ai-credit">
        {budget?.remaining != null ? (
          <><span>Credit left</span><b className={budget.max && budget.remaining < budget.max * 0.1 ? 'tone-bad' : ''}>{money(budget.remaining, cur)}</b>
            <span className="muted small">of {money(budget.max!, cur)}{resets ? ` · resets ${resets}` : ''}</span></>
        ) : budget?.spend != null ? (
          <><span>Spent this month</span><b>{money(budget.spend, cur)}</b><span className="muted small">(no budget reported; set AI_MONTHLY_BUDGET on the server)</span></>
        ) : (
          <span className="small muted">Credit: the AI gateway does not report it{budget ? '' : ' (checking…)'}.</span>
        )}
        {budget && <span className="small muted ai-today">Today {budget.today.used} of {budget.today.limit} checks</span>}
      </div>

      <label className="toggle">
        <input type="checkbox" checked={afterDetect} onChange={(e) => { setAfterDetect(e.target.checked); aiPrefs.setAfterDetect(e.target.checked); }} />
        <span>Check every rally after the detection <small className="muted">· one request per rally</small></span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={examples} onChange={(e) => { setExamples(e.target.checked); aiPrefs.setExamples(e.target.checked); }} />
        <span>Show the AI my corrections <small className="muted">· sends {stats?.examples ? `up to ${Math.min(stats.examples, budget?.maxExamples ?? 3)} of your ${stats.examples} corrected touches` : 'your corrected touches (none saved yet)'} with every check, so each costs more</small></span>
      </label>

      <details className="ai-fields">
        <summary className="small">What it fills in, and how often it was right</summary>
        <table className="small">
          <tbody>
            {FIELDS.map(({ field, label }) => {
              const t = trustFor(stats?.fields, field);
              const pct = t.rate != null ? `${Math.round(t.rate * 100)}% right` : 'no answers yet';
              return (
                <tr key={field}>
                  <td>{label}</td>
                  <td className={t.off ? 'tone-bad' : ''}>{t.off ? 'only shown' : 'applied when sure'}</td>
                  <td className="muted">{t.n < TRUST_AFTER ? `${pct} · learning ${t.n}/${TRUST_AFTER}` : pct}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small muted">Every rally you save tells it which answers were right. A kind of answer that is right less than 70% of the time is only shown on the chip, no longer filled in.</p>
      </details>

      {todo.length > 0 ? (
        <div className={`ai-estimate small ${est.ok ? '' : 'warn'}`}>
          {plural(todo.length, 'rally', 'rallies')} in Review not checked yet ({touches} touches{examples ? ` + up to ${est.pictures - touches} example pictures` : ''})
          {est.cost != null ? <> · about <b>{money(est.cost, cur)}</b></> : budget ? ' · cost not known until the first check' : ''}
          {' · '}{est.overBudget ? <b>more than the credit left</b> : est.overDay ? <b>more than today's {budget!.today.limit - budget!.today.used} checks left</b> : <b className="tone-good">fine ✓</b>}
        </div>
      ) : (
        <div className="ai-estimate small muted">
          {budget?.perTouch != null ? `About ${money(budget.perTouch, cur)} per touch so far, so a match of ~400 touches costs about ${money(budget.perTouch * 400 * (examples ? 1.3 : 1), cur)}.` : 'Run the detection first; the cost per touch shows after the first check.'}
        </div>
      )}

      {native && job && (jobRunning || job.state === 'failed') ? (
        <div className="job">
          <div className="progress"><div style={{ width: `${Math.round(Math.max(0.02, job.progress) * 100)}%` }} /></div>
          <span className="small">{job.state === 'failed' ? `Stopped: ${job.error ?? 'failed'}` : job.message ?? 'AI check…'}</span>
          {jobRunning ? <button className="btn-ghost small" onClick={() => Native.cancelAiCheck({ matchId: match.id })}>Stop</button>
            : <button className="btn-ghost small" onClick={() => setJob(null)}>OK</button>}
          {jobRunning && <span className="small muted">Runs in the background: you can leave the app.</span>}
        </div>
      ) : run ? (
        <div className="job">
          <div className="progress"><div style={{ width: `${Math.round((run.total ? run.done / run.total : 0) * 100)}%` }} /></div>
          <span className="small">{run.note ? `Stopped: ${run.note}` : `AI check: rally ${run.done} of ${run.total}`}</span>
          {run.note ? <button className="btn-ghost small" onClick={() => setRun(null)}>OK</button>
            : <button className="btn-ghost small" onClick={() => { stop.current = true; }}>Stop</button>}
        </div>
      ) : todo.length > 0 && (
        <button className="btn wide ai-run-all" disabled={!url && !native} onClick={() => checkEverything()}>
          <Sparkles /> AI check {todo.length === 1 ? 'the rally' : `all ${todo.length} rallies`} now
          {!url && !native && <small className="muted"> (load the video file first)</small>}
        </button>
      )}
    </div>
  );
}
