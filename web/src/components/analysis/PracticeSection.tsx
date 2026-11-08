import { useMemo, useState, type ReactNode } from 'react';
import type { Match, Player, VEvent } from '../../lib/api';
import { orderAt } from '../../lib/rotation';
import {
  changes, effOf, findings, passers, playerTimeline, pointSources, setterHitter, setterRows, sideSets,
  SLOT_NAMES, who, type KeyNumber, type SideSet, type Tally,
} from '../../lib/practiceAnalysis';
import type { Ratio } from '../../lib/sequence';
import { BarChart, LineChart, Scatter, SERIES } from '../../charts/Charts';
import { scoreFlow } from '../../report/analytics';
import { playerStats } from '../../lib/stats';
import { ERROR_KINDS, errorKind } from '../../lib/trajectory';
import { ERROR_TYPES } from './ErrorsSection';
import { More } from './More';
import { avg2, eff3, enough, judge, pct, Val, type Tone } from './ui';

type View = 'sets' | 'combos' | 'players';

/**
 * A practice match: both sides are ours, mixed anew each set. Instead of "us" and "them": each
 * set's two sides next to each other, how the combinations worked, and each player's sets.
 */
export function PracticeSection({ match, players, events }: { match: Match; players: Player[]; events: VEvent[] }) {
  const sides = useMemo(() => sideSets(match, players, events), [match, players, events]);
  const [view, setView] = useState<View>('sets');
  if (!sides.length) return <p className="muted small">No sides set yet: pick who plays on which side for each set on the tag screen.</p>;
  return (
    <div className="charts practice-analysis">
      <div className="segmented" role="tablist">
        {([['sets', 'Set by set'], ['combos', 'Combinations'], ['players', 'Players']] as [View, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      {view === 'sets' && <SetCards sides={sides} players={players} />}
      {view === 'combos' && <Combos sides={sides} players={players} />}
      {view === 'players' && <PlayerSets sides={sides} players={players} />}
    </div>
  );
}

/** A title with a small "?" that opens what the table shows and how to read it. */
function Head({ title, help, children }: { title: string; help: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="help-head">
        <b>{title}</b>
        <button className={`help-q ${open ? 'on' : ''}`} aria-expanded={open} aria-label={`What "${title}" shows`} onClick={() => setOpen(!open)}>?</button>
        {children}
      </div>
      {open && <div className="help-text small">{help}</div>}
    </>
  );
}

const name = (players: Player[], id: number | null | undefined) => who(players.find((p) => p.id === id));
const ratioText = (r: Ratio) => (r.n ? `${pct(r.won / r.n)} (${r.won}/${r.n})` : '–');
const tallyCell = (t: Tally | undefined, min = 4): { text: string; tone: Tone; sub: string } =>
  !t || !t.n ? { text: '', tone: null, sub: '' } : { text: eff3(effOf(t)), tone: t.n >= min ? judge.eff(effOf(t)) : 'few', sub: `${t.kills}-${t.errors}/${t.n}` };

/** The line-up as the court: front row 4 3 2, back row 5 6 1. */
function MiniCourt({ side, players }: { side: SideSet; players: Player[] }) {
  if (!side.lineup) {
    return (
      <>
        <ul className="practice-roster">{side.players.map((id) => <li key={id}>{name(players, id)}{side.roleOf.get(id) ? <small className="muted"> {side.roleOf.get(id)}</small> : null}</li>)}</ul>
        <span className="small muted">No line-up saved for this side.</span>
      </>
    );
  }
  const order = orderAt(side.lineup, 0);
  const cell = (pos: number) => {
    const id = order[pos - 1];
    const p = players.find((x) => x.id === id);
    return (
      <span key={pos} className={`mini-pos ${id != null && id === side.setter ? 'is-setter' : ''}`}>
        <b>{id == null ? '–' : `#${p?.number ?? '–'}`}</b>
        <small>{p?.name.split(' ')[0] ?? ''}{id != null && side.roleOf.get(id) ? ` · ${side.roleOf.get(id)}` : ''}</small>
      </span>
    );
  };
  return (
    <div className="mini-court" aria-label={`Line-up of ${side.label}`}>
      {[4, 3, 2, 5, 6, 1].map(cell)}
      {side.lineup.libero != null && !order.includes(side.lineup.libero) && <span className="mini-libero">Libero {name(players, side.lineup.libero)}</span>}
    </div>
  );
}

interface Row { label: string; cell: (s: SideSet) => { text: string; tone?: Tone; title?: string } }
const ROWS: Row[] = [
  { label: 'Points', cell: (s) => ({ text: String(s.pointsFor) }) },
  { label: 'Side-out', cell: (s) => ({ text: ratioText(s.sideout), tone: s.sideout.n >= 5 ? judge.sideout(s.sideout.won / s.sideout.n) : null }) },
  { label: 'Break', cell: (s) => ({ text: ratioText(s.brk), tone: s.brk.n >= 5 ? judge.break(s.brk.won / s.brk.n) : null }) },
  { label: 'Attack', cell: (s) => ({ text: s.line.attempts ? `${eff3(s.line.attackEff)} (${s.line.kills}-${s.line.attackErrors}/${s.line.attempts})` : '–', tone: enough(s.line.attempts) ? judge.eff(s.line.attackEff) : null }) },
  { label: 'Pass', cell: (s) => ({ text: s.line.receptions ? `${avg2(s.line.recAvg)} (${s.line.receptions})` : '–', tone: enough(s.line.receptions) ? judge.passAvg(s.line.recAvg) : null }) },
  { label: 'Aces / serve errors', cell: (s) => ({ text: `${s.line.aces} / ${s.line.serveErrors}` }) },
  { label: 'Block points', cell: (s) => ({ text: String(s.line.blockPoints) }) },
  { label: 'Errors', cell: (s) => ({ text: String(s.line.errors) }) },
];

function SetCards({ sides, players }: { sides: SideSet[]; players: Player[] }) {
  const sets = [...new Set(sides.map((s) => s.set))];
  return (
    <>
      <Head title="Set by set" help={<>
        <p>Each set's two sides, named after who set for them in that set. The court is the starting line-up; the setter is shaded.</p>
        <p>The table is the <b>whole side</b> in this set, all its players together, not the setter alone. Side-out: rallies won when the other side served (won/played). Break: rallies won on the side's own serve. Attack: (kills − errors) / attacks, with kills-errors/attacks in brackets. Pass: average grade 0–3. Errors: all errors of the side (attack, serve, pass, set, block, dig).</p>
      </>} />
      {sets.map((set) => {
        const two = sides.filter((s) => s.set === set);
        const tagged = two.some((s) => s.tagged);
        return (
          <section key={set} className="chart practice-set" aria-label={`Set ${set}`}>
            <div className="row between">
              <b>Set {set}</b>
              {tagged && <span className="practice-set-score">{two.map((s) => s.pointsFor).join(' : ')}</span>}
            </div>
            <div className="practice-two">
              {two.map((s) => (
                <div key={s.side} className={`practice-col side-${s.side}`}>
                  <b className="practice-col-head">{s.label}{tagged && s.pointsFor > s.pointsAgainst ? ' · won' : ''}</b>
                  <MiniCourt side={s} players={players} />
                </div>
              ))}
            </div>
            {!tagged ? <p className="small muted">No tags in this set.</p> : (
              <>
                <div className="table-wrap">
                  <table className="stat-table">
                    <thead><tr><th></th>{two.map((s) => <th key={s.side}>{s.label}</th>)}</tr></thead>
                    <tbody>
                      {ROWS.map((r) => (
                        <tr key={r.label}><td>{r.label}</td>{two.map((s) => { const c = r.cell(s); return <td key={s.side} title={c.title}><Val tone={c.tone}>{c.text}</Val></td>; })}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary className="small">Players and rotations</summary>
                  {two.map((s) => <SidePlayers key={s.side} side={s} players={players} />)}
                </details>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

const keyTone = (k: KeyNumber): Tone => (k.n < 4 ? 'few' : k.kind === 'pass' ? judge.passAvg(k.value) : judge.eff(k.value));
const Keys = ({ keys }: { keys: KeyNumber[] }) => keys.length
  ? <span className="practice-keys">{keys.map((k) => <span key={k.kind}>{k.label} <Val tone={keyTone(k)}>{k.text}</Val></span>)}</span>
  : <span className="small muted">nothing tagged</span>;

function SidePlayers({ side, players }: { side: SideSet; players: Player[] }) {
  const ids = [...side.perPlayer.keys()].sort((a, b) => (players.find((p) => p.id === a)?.number ?? 99) - (players.find((p) => p.id === b)?.number ?? 99));
  const rot = side.rotations.filter((r) => r.serving + r.receiving > 0);
  return (
    <div className="practice-side-detail">
      <b className="small">{side.label}</b>
      <ul className="practice-players">
        {ids.map((id) => {
          const role = side.roleOf.get(id) ?? null;
          return (
            <li key={id}>
              <span>{name(players, id)}{role ? <small className="muted"> {SLOT_NAMES[role]}</small> : null}</span>
              <Keys keys={keysOf(side, id)} />
            </li>
          );
        })}
      </ul>
      {rot.length > 0 && (
        <p className="small muted">Rallies won per rotation (S1 = setter in position 1): {rot.map((r) => `S${r.pos} ${r.sideOuts + r.breaks}/${r.serving + r.receiving}`).join(' · ')}</p>
      )}
    </div>
  );
}

const keysOf = (side: SideSet, id: number) => playerTimeline(id, [side])[0]?.keys ?? [];

function Combos({ sides, players }: { sides: SideSet[]; players: Player[] }) {
  const f = useMemo(() => findings(players, sides), [players, sides]);
  const st = useMemo(() => setterRows(sides), [sides]);
  const pairs = useMemo(() => setterHitter(sides), [sides]);
  const ps = useMemo(() => passers(sides), [sides]);
  const ch = useMemo(() => changes(players, sides), [players, sides]);
  const setters = st.map((r) => r.setter).filter((s) => pairs.some((p) => p.setter === s));
  const hitters = [...new Set(pairs.filter((p) => setters.includes(p.setter)).map((p) => p.hitter))]
    .sort((a, b) => pairs.filter((p) => p.hitter === b).reduce((s, p) => s + p.n, 0) - pairs.filter((p) => p.hitter === a).reduce((s, p) => s + p.n, 0));
  return (
    <>
      {f.length > 0 && (
        <section className="findings">
          <Head title="What the data says" help={<p>The clearest results from the tables below, each only with at least 4 attacks or 8 passes behind it. One practice match is a small sample: take them as things to try again, not as verdicts.</p>} />
          <ul>{f.map((x, i) => <li key={i}><Val tone={x.tone === 'info' ? null : x.tone}>{x.text}</Val></li>)}</ul>
        </section>
      )}

      {st.length > 0 && (
        <section className="chart">
          <Head title="Setters" help={<>
            <p>Each player who set, over the sets they set for their side.</p>
            <p><b>Side-out</b> and <b>Break</b>: rallies their side won when the other side served, and on its own serve (won/played). <b>Hitters</b>: attack efficiency of all attacks right after this setter's set, (kills − errors) / attacks. <b>Good pass</b> and <b>Poor pass</b>: the same, split by the pass or dig before the set (grade 2–3 or 0–1); a setter who keeps the hitters scoring after poor passes is worth a lot. <b>Sets to</b>: who got their sets most often.</p>
            <p>Grey: fewer than 4 attacks, too few to judge.</p>
          </>} />
          <div className="table-wrap">
            <table className="stat-table">
              <thead><tr><th>Setter</th><th>Sets</th><th>Side-out</th><th>Break</th><th>Hitters</th><th>Good pass</th><th>Poor pass</th><th>Sets to</th></tr></thead>
              <tbody>
                {st.map((r) => {
                  const cells = [r.all, r.good, r.poor].map((t) => tallyCell(t));
                  return (
                    <tr key={r.setter}>
                      <td>{name(players, r.setter)}</td>
                      <td>{r.sets.join(', ')}</td>
                      <td>{ratioText(r.sideout)}</td>
                      <td>{ratioText(r.brk)}</td>
                      {cells.map((c, i) => <td key={i}>{c.text ? <><Val tone={c.tone}>{c.text}</Val> <small className="muted">{c.sub}</small></> : '–'}</td>)}
                      <td className="small">{r.spread.slice(0, 3).map((x) => `${name(players, x.hitter).split(' ')[0]} ${Math.round((x.n / r.all.n) * 100)}%`).join(' · ') || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hitters.length > 0 && setters.length > 0 && (
        <section className="chart">
          <Head title="Setter and hitter" help={<p>Every attack right after a set, by who set and who hit: attack efficiency (kills − errors) / attacks, with kills-errors/attacks below. Read a row to see how one hitter did with each setter; an empty cell means that setter never set them. Grey: fewer than 4 attacks.</p>} />
          <div className="table-wrap">
            <table className="stat-table">
              <thead><tr><th>Hitter</th>{setters.map((s) => <th key={s}>{name(players, s)} sets</th>)}</tr></thead>
              <tbody>
                {hitters.map((h) => (
                  <tr key={h}>
                    <td>{name(players, h)}</td>
                    {setters.map((s) => {
                      const c = tallyCell(pairs.find((x) => x.setter === s && x.hitter === h));
                      return <td key={s}>{c.text ? <><Val tone={c.tone}>{c.text}</Val><br /><small className="muted">{c.sub}</small></> : ''}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ps.length > 0 && (
        <section className="chart">
          <Head title="Passers" help={<p>Everyone who received serve, libero included: average pass grade 0–3, perfect passes (3) and pass errors (0). <b>Attack after</b>: how the side's first attack went after this player's pass, (kills − errors) / attacks.</p>} />
          <div className="table-wrap">
            <table className="stat-table">
              <thead><tr><th>Passer</th><th>Passes</th><th>Average</th><th>Perfect</th><th>Errors</th><th>Attack after</th></tr></thead>
              <tbody>
                {ps.map((r) => {
                  const c = tallyCell(r.after);
                  return (
                    <tr key={r.player}>
                      <td>{name(players, r.player)}{r.roles.length ? <small className="muted"> {r.roles.join('/')}</small> : null}</td>
                      <td>{r.n}</td>
                      <td><Val tone={r.n >= 5 ? judge.passAvg(r.avg) : 'few'}>{avg2(r.avg)}</Val></td>
                      <td>{r.perfect}</td>
                      <td>{r.errors}</td>
                      <td>{c.text ? <><Val tone={c.tone}>{c.text}</Val> <small className="muted">{c.sub}</small></> : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ch.length > 0 && (
        <section className="chart">
          <Head title="What changed from set to set" help={<p>Players who had a different setter from one set to the next, with the number that fits their role: attack efficiency for hitters, pass average for passers and liberos. Only when both sets have at least 3 of them.</p>} />
          <ul className="practice-changes">
            {ch.map((c, i) => (
              <li key={i}>
                <span><b>{name(players, c.player)}</b> <small className="muted">set {c.from.set} → {c.to.set}</small></span>
                <span className="small">{c.what.join(' · ')}</span>
                <span className="small">{c.before.label}: <Val tone={keyTone(c.before)}>{c.before.text}</Val> → <Val tone={keyTone(c.after)}>{c.after.text}</Val></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!f.length && !st.length && !pairs.length && !ps.length && <p className="muted small">Not enough tagged yet to compare combinations.</p>}
    </>
  );
}

function PlayerSets({ sides, players }: { sides: SideSet[]; players: Player[] }) {
  const ids = [...new Set(sides.flatMap((s) => [...s.perPlayer.keys(), ...s.players]))]
    .sort((a, b) => (players.find((p) => p.id === a)?.number ?? 99) - (players.find((p) => p.id === b)?.number ?? 99));
  const [pick, setPick] = useState<number | null>(null);
  const id = pick ?? ids[0];
  const tl = id == null ? [] : playerTimeline(id, sides);
  return (
    <>
      <Head title="A player's sets" help={<p>Pick a player to see their sets one after the other: who set for them, their teammates, how their side's set ended, and their own numbers for their role: attack efficiency (kills − errors) / attacks for hitters, pass average for passers and liberos, the hitters' efficiency after their sets for setters. Grey: too few to judge.</p>} />
      <div className="chips">
        {ids.map((x) => <button key={x} className={`chip ${x === id ? 'on' : ''}`} onClick={() => setPick(x)}>{name(players, x)}</button>)}
      </div>
      <ol className="practice-timeline">
        {tl.map((s) => {
          const mates = s.side.players.filter((x) => x !== id && x !== s.setter);
          return (
            <li key={s.set} className="chart">
              <div className="row between">
                <b>Set {s.set}{s.role ? ` · ${SLOT_NAMES[s.role]}` : ''}</b>
                {s.side.tagged && <span className="small">{s.side.pointsFor} : {s.side.pointsAgainst}{s.won == null ? '' : s.won ? ' won' : ' lost'}</span>}
              </div>
              <p className="small muted">
                {s.setter === id ? 'Setting' : s.setter != null ? `${name(players, s.setter)} setting` : 'Setter unknown'}
                {mates.length ? ` · with ${mates.map((m) => name(players, m)).join(', ')}` : ''}
              </p>
              <Keys keys={s.keys} />
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * Errors in a practice match: no "us" and "them" but each set's two sides: where each side's
 * points came from (its own kills, aces and blocks, or the other side's errors), the errors each
 * side made, and per player.
 */
export function PracticeErrors({ match, players, events }: { match: Match; players: Player[]; events: VEvent[] }) {
  const sides = useMemo(() => sideSets(match, players, events).filter((s) => s.tagged), [match, players, events]);
  const own = useMemo(() => events.filter((e) => e.match_id === match.id && e.player_id != null), [events, match.id]);
  if (!sides.length) return <p className="muted small">No tags yet.</p>;
  const isError = (e: VEvent) => ERROR_TYPES.some((t) => t.test(e));
  const errs = (s: SideSet) => s.events.filter((e) => e.player_id != null && isError(e));
  const rows = players
    .map((p) => {
      const mine = own.filter((e) => e.player_id === p.id);
      return { p, errs: mine.filter(isError), pts: mine.filter((e) => (e.action === 'kill' || e.action === 'ace' || e.action === 'block_point') && !e.noPoint).length };
    })
    .filter((r) => r.errs.length || r.pts)
    .sort((a, b) => b.errs.length - a.errs.length);
  const attackKinds = ERROR_KINDS.map((k) => ({ ...k, n: own.filter((e) => (e.action === 'attack_error' || e.action === 'attack_blocked') && errorKind(e) === k.key).length }));
  const serveKinds = ERROR_KINDS.filter((k) => k.key !== 'blocked').map((k) => ({ ...k, n: own.filter((e) => e.action === 'serve_error' && errorKind(e) === k.key).length }));
  const label = (s: SideSet) => `Set ${s.set} · ${s.label}`;
  return (
    <div className="charts practice-analysis">
      {rows.length > 0 && (
        <section className="chart">
          <Head title="Errors per player" help={<p>Each player's errors over the whole match by kind, next to the points they scored themselves (kills, aces, block points). +/−: points minus errors.</p>} />
          <div className="table-wrap">
            <table className="stat-table">
              <thead><tr><th>Player</th>{ERROR_TYPES.map((t) => <th key={t.key} title={t.label}>{t.short}</th>)}<th>Errors</th><th>Points</th><th>+/−</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const v = r.pts - r.errs.length;
                  return (
                    <tr key={r.p.id}>
                      <td>{name(players, r.p.id)}</td>
                      {ERROR_TYPES.map((t) => <td key={t.key}>{r.errs.filter(t.test).length || '·'}</td>)}
                      <td>{r.errs.length}</td><td>{r.pts}</td>
                      <td><Val tone={judge.plusMinus(v)}>{v > 0 ? `+${v}` : v}</Val></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="chart">
        <Head title="Where the points came from" help={<p>Each set's two sides: their points, split into what they won themselves (kills, aces, block points) and what the other side gave away with an error (serve, attack, set, pass, dig, block). <b>Earned</b>: the share won themselves. Not specified: points tagged without saying how.</p>} />
        <div className="table-wrap">
          <table className="stat-table">
            <thead><tr><th>Side</th><th>Points</th><th>Kills</th><th>Aces</th><th>Blocks</th><th>Other side's errors</th><th>Not specified</th><th>Earned</th></tr></thead>
            <tbody>
              {sides.map((s) => {
                const p = pointSources(s);
                const earned = s.pointsFor ? (p.kills + p.aces + p.blocks) / s.pointsFor : null;
                return (
                  <tr key={`${s.set}${s.side}`}>
                    <td>{label(s)}</td><td>{s.pointsFor}</td><td>{p.kills}</td><td>{p.aces}</td><td>{p.blocks}</td><td>{p.fromErrors}</td><td>{p.other || '·'}</td>
                    <td><Val tone={earned == null || s.pointsFor < 8 ? null : earned >= 0.6 ? 'good' : earned < 0.4 ? 'bad' : null}>{pct(earned)}</Val></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <More id="practice-errors">
      <section className="chart">
        <Head title="Errors per side" help={<p>The errors each side made in each set, by kind: serve, attack out or into the net, attacks that got blocked, set errors, passes graded 0, dig errors and block errors. A blocked attack counts here even when the block point already gave the point.</p>} />
        <div className="table-wrap">
          <table className="stat-table">
            <thead><tr><th>Side</th>{ERROR_TYPES.map((t) => <th key={t.key} title={t.label}>{t.short}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {sides.map((s) => {
                const list = errs(s);
                return (
                  <tr key={`${s.set}${s.side}`}>
                    <td>{label(s)}</td>
                    {ERROR_TYPES.map((t) => <td key={t.key}>{list.filter(t.test).length || '·'}</td>)}
                    <td><b>{list.length}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {attackKinds.some((k) => k.n) && <BarChart title="How attacks failed" subtitle="Attack errors and blocked attacks by where the ball went (from the second tap), both sides"
        rows={attackKinds.filter((k) => k.n).map((k) => ({ label: k.label, value: k.n }))} valueTitle="Attacks" fmt={(v) => String(Math.round(v))} color="#d03b3b" />}
      {serveKinds.some((k) => k.n) && <BarChart title="How serves failed" subtitle="Serve errors by where the ball went, both sides"
        rows={serveKinds.filter((k) => k.n).map((k) => ({ label: k.label, value: k.n }))} valueTitle="Serves" fmt={(v) => String(Math.round(v))} color="#d03b3b" />}
      </More>
    </div>
  );
}

/**
 * Overview of a practice match: the score of each set as it went, the sides named after their
 * setter, and each player's attack volume against efficiency. No "us" and "them".
 */
export function PracticeOverview({ match, players, events }: { match: Match; players: Player[]; events: VEvent[] }) {
  const sides = useMemo(() => sideSets(match, players, events), [match, players, events]);
  const flow = useMemo(() => scoreFlow(events.filter((e) => e.match_id === match.id)), [events, match.id]);
  const attackers = useMemo(() => playerStats(players, events).filter((r) => r.stats.attempts > 0), [players, events]);
  if (!flow.length && !attackers.length) return <p className="muted small">No tags yet.</p>;
  const nameOf = (set: number, side: 'a' | 'b') => sides.find((s) => s.set === set && s.side === side)?.label ?? (side === 'a' ? match.practice?.names.a : match.practice?.names.b) ?? side;
  return (
    <div className="charts">
      {flow.map(({ set, points }) => {
        const last = points[points.length - 1];
        return (
          <LineChart key={set} title={`Set ${set} · score progression`} subtitle={`${nameOf(set, 'a')} ${last.us} : ${last.them} ${nameOf(set, 'b')}, after ${last.i} rallies`}
            series={[
              { name: nameOf(set, 'a'), color: SERIES.blue, points: points.map((p) => ({ x: p.i, y: p.us })) },
              { name: nameOf(set, 'b'), color: SERIES.orange, points: points.map((p) => ({ x: p.i, y: p.them })) },
            ]}
            xTitle="Rally" yTitle="Points" step />
        );
      })}
      {attackers.length > 0 && (
        <Scatter title="Volume vs efficiency" subtitle="Each dot is a player: how often they attacked and how well, both sides"
          points={attackers.map((r) => ({ x: r.stats.attempts, y: r.stats.attackEff ?? 0, label: `#${r.player.number ?? '–'}`, name: who(r.player) }))}
          xTitle="Attempts" yTitle="Efficiency" yFmt={(v) => v.toFixed(2).replace(/^(-?)0\./, '$1.')} />
      )}
    </div>
  );
}

/** Rotations of a practice match: each side's rallies won per rotation, set by set (needs the line-ups). */
export function PracticeRotations({ match, players, events }: { match: Match; players: Player[]; events: VEvent[] }) {
  const sides = useMemo(() => sideSets(match, players, events).filter((s) => s.rotations.some((r) => r.serving + r.receiving > 0)), [match, players, events]);
  if (!sides.length) return <p className="muted small">Enter both sides' line-ups for a set (Line-up on the tag screen) to see its rotations.</p>;
  const cell = (r: SideSet['rotations'][number]) => {
    const n = r.serving + r.receiving, won = r.sideOuts + r.breaks;
    if (!n) return <span className="muted">·</span>;
    return <Val tone={n >= 4 ? judge.win(won / n) : null} title={`Side-out ${r.sideOuts}/${r.receiving} · break ${r.breaks}/${r.serving}`}>{won}/{n}</Val>;
  };
  return (
    <div className="charts practice-analysis">
      <section className="chart">
        <Head title="Rotations per side" help={<p>For each set and side: the rallies it won in each rotation (won/played). S1 = its setter in position 1 (serving), S2 = setter in position 2, and so on. Tap or hover a number for side-out (won on the other side's serve) and break (won on its own serve). From the starting line-ups and the points as they were tagged.</p>} />
        <div className="table-wrap">
          <table className="stat-table">
            <thead><tr><th>Side</th>{[1, 2, 3, 4, 5, 6].map((k) => <th key={k}>S{k}</th>)}</tr></thead>
            <tbody>
              {sides.map((s) => (
                <tr key={`${s.set}${s.side}`}><td>Set {s.set} · {s.label}</td>{s.rotations.map((r) => <td key={r.pos}>{cell(r)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
