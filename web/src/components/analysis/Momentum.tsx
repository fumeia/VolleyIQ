import { actionLabel } from '../../lib/actions';
import type { Player, VEvent } from '../../lib/api';
import { buildRallies, isClutch, phaseScoring, SERVES, scoringRuns, withScore, type Rally } from '../../lib/sequence';
import { scoreBySet, teamLine } from '../../lib/stats';
import { errorPct, tally } from '../../lib/trajectory';
import { ERROR_TYPES } from './ErrorsSection';
import { avg2, eff3, judge, pct, PlayBtn, plural, ratio, StatFigure } from './ui';

const isError = (e: VEvent) => ERROR_TYPES.some((t) => t.test(e));

/** What ended a rally, in words: "Serve error #5", "their winner", "Kill #9". */
function cause(r: Rally, players: Player[]) {
  const e = r.end;
  if (!e) return '?';
  if (e.action === 'opp_point') return 'their winner';
  if (e.action === 'opp_error') return 'their error';
  const p = players.find((x) => x.id === e.player_id);
  return `${actionLabel(e)}${p ? ` #${p.number ?? '–'}` : ''}`;
}

/** Per set: how each part of the game went, to see where a set was won or lost. */
export function SetsTable({ events }: { events: VEvent[] }) {
  const multi = new Set(events.map((e) => e.match_id)).size > 1;
  const sets = [...new Set(events.map((e) => e.set_no ?? 1))].sort((a, b) => a - b);
  if (sets.length < 2) return null;
  const rows = sets.map((n) => ({ n, evs: events.filter((e) => (e.set_no ?? 1) === n) }));
  return (
    <StatFigure title={multi ? 'By set number (all matches)' : 'Set by set'}
      subtitle="Where a set was won or lost: green = good, red = needs work"
      rows={rows} rowKey={(r) => r.n}
      first={{ h: 'Set', cell: (r) => `Set ${r.n}` }}
      columns={[
        ...(multi ? [] : [{ h: 'Score', cell: (r: (typeof rows)[number]) => {
          const s = scoreBySet(r.evs)[0];
          return s ? { text: `${s.us}–${s.them}`, tone: s.us > s.them ? 'good' as const : 'bad' as const } : '–';
        } }]),
        { h: 'Side-out', cell: (r) => { const p = phaseScoring(buildRallies(r.evs)); return { text: pct(p.sideoutPct), tone: p.sideout.n >= 5 ? judge.sideout(p.sideoutPct) : null }; } },
        { h: 'Break', cell: (r) => { const p = phaseScoring(buildRallies(r.evs)); return { text: pct(p.breakPct), tone: p.break.n >= 5 ? judge.break(p.breakPct) : null }; } },
        { h: 'Att. eff', cell: (r) => { const t = teamLine(r.evs); return { text: eff3(t.attackEff), tone: t.attempts >= 5 ? judge.eff(t.attackEff) : null }; } },
        { h: 'Pass', cell: (r) => { const t = teamLine(r.evs); return { text: avg2(t.recAvg), tone: t.receptions >= 5 ? judge.passAvg(t.recAvg) : null }; } },
        { h: 'Srv err', cell: (r) => { const t = tally(r.evs.filter((e) => SERVES.includes(e.action))); return { text: pct(errorPct(t)), tone: t.n >= 5 ? judge.serveErrPct(errorPct(t)) : null }; } },
        { h: 'Errors', cell: (r) => r.evs.filter(isError).length },
      ]} />
  );
}

/** Scoring runs (4+ in a row) and how the points in the opponent's runs came about; end-of-set play. */
export function MomentumBlock({ players, rallies }: { players: Player[]; rallies: Rally[] }) {
  const runs = scoringRuns(rallies, 4);
  const against = runs.filter((r) => r.side === 'them');
  const ours = runs.filter((r) => r.side === 'us');
  const scored = withScore(rallies).filter((x) => x.rally.won != null);
  const clutch = scored.filter((x) => isClutch(x.before, x.rally.set));
  const rest = scored.filter((x) => !isClutch(x.before, x.rally.set));
  const sideout = (xs: typeof scored) => { const r = xs.filter((x) => x.rally.weServed === false); return { won: r.filter((x) => x.rally.won).length, n: r.length }; };
  const breakp = (xs: typeof scored) => { const r = xs.filter((x) => x.rally.weServed === true); return { won: r.filter((x) => x.rally.won).length, n: r.length }; };
  const errRate = (xs: typeof scored) => ratio(xs.filter((x) => x.rally.end && isError(x.rally.end)).length, xs.length);

  if (!runs.length && clutch.length < 6) return null;
  return (
    <>
      {against.length > 0 && (
        <figure className="chart">
          <figcaption>
            <div className="chart-title"><b>Runs against us</b></div>
            <span className="chart-sub">4+ opponent points in a row and how each point was lost: the moments for a timeout or a sub</span>
          </figcaption>
          <ul className="runs">
            {against.sort((a, b) => b.length - a.length).slice(0, 8).map((r, i) => {
              const own = r.rallies.filter((x) => x.end && isError(x.end)).length;
              return (
                <li key={i}>
                  <b className="tone-bad">{r.length}–0</b> Set {r.set}, {r.from.us}:{r.from.them} → {r.to.us}:{r.to.them}
                  <span className="muted"> · {own ? `${plural(own, 'own error')}: ` : ''}{r.rallies.map((x) => cause(x, players)).join(', ')}</span>
                  {' '}<PlayBtn list={r.rallies.map((x) => x.touches[x.touches.length - 1] ?? x.end).filter((e): e is VEvent => !!e)} />
                </li>
              );
            })}
          </ul>
          {ours.length > 0 && (
            <p className="chart-note-inline">Our runs: {ours.sort((a, b) => b.length - a.length).slice(0, 4).map((r) => `${r.length}–0 in set ${r.set}`).join(' · ')}</p>
          )}
        </figure>
      )}

      {clutch.length >= 6 && (
        <StatFigure title="End of the set (20+ points)" subtitle="Rallies where either team had 20 or more points, against the rest of the set"
          rows={[{ label: 'At 20+', xs: clutch }, { label: 'Before 20', xs: rest }]} rowKey={(r) => r.label}
          first={{ h: '', cell: (r) => r.label }}
          columns={[
            { h: 'Rallies', cell: (r) => r.xs.length },
            { h: 'Won', cell: (r) => { const v = ratio(r.xs.filter((x) => x.rally.won).length, r.xs.length); return { text: pct(v), tone: r.xs.length >= 6 ? judge.win(v) : null }; } },
            { h: 'Side-out', cell: (r) => { const s = sideout(r.xs); const v = ratio(s.won, s.n); return { text: pct(v), tone: s.n >= 5 ? judge.sideout(v) : null, title: `${s.won}/${s.n}` }; } },
            { h: 'Break', cell: (r) => { const s = breakp(r.xs); const v = ratio(s.won, s.n); return { text: pct(v), tone: s.n >= 5 ? judge.break(v) : null, title: `${s.won}/${s.n}` }; } },
            { h: 'Lost on own error', cell: (r) => { const v = errRate(r.xs); return { text: pct(v), tone: v != null && r.xs.length >= 6 ? (v >= 0.4 ? 'bad' : v <= 0.2 ? 'good' : null) : null }; } },
          ]} />
      )}
    </>
  );
}

