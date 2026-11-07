import { useMemo, useState, type ReactNode } from 'react';
import type { Match, Player, VEvent } from '../../lib/api';
import { orderAt } from '../../lib/rotation';
import {
  changes, effOf, findings, hittersByPosition, passers, playerTimeline, setterHitter, setterRows, sideSets,
  SLOT_NAMES, who, type KeyNumber, type SideSet, type SlotRole, type Tally,
} from '../../lib/practiceAnalysis';
import type { Ratio } from '../../lib/sequence';
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
        <p>Each set's two sides, named after who set for them in that set (whoever set most; with no sets tagged, the player with the setter role). The court is the starting line-up as saved on the tag screen; the setter is shaded. The position next to each name (S, OH, MB, OPP) is worked out from where the player stood relative to the setter, so it is what they played in this set, not their usual role. A libero who played in the six counts as the middle there.</p>
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
  const pos = useMemo(() => hittersByPosition(sides).sort((a, b) => sum(b.by) - sum(a.by)), [sides]);
  const ps = useMemo(() => passers(sides), [sides]);
  const ch = useMemo(() => changes(players, sides), [players, sides]);
  const setters = st.map((r) => r.setter).filter((s) => pairs.some((p) => p.setter === s));
  const hitters = [...new Set(pairs.filter((p) => setters.includes(p.setter)).map((p) => p.hitter))]
    .sort((a, b) => pairs.filter((p) => p.hitter === b).reduce((s, p) => s + p.n, 0) - pairs.filter((p) => p.hitter === a).reduce((s, p) => s + p.n, 0));
  const roles: SlotRole[] = ['OH', 'OPP', 'MB'];
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

      {pos.some((h) => Object.keys(h.by).length) && (
        <section className="chart">
          <Head title="Hitters by position" help={<p>Each hitter's attacks by the position they played in that set (outside, opposite, middle), worked out from the line-ups. Shows where someone hits best. Attack efficiency (kills − errors) / attacks, kills-errors/attacks below. Sets without a saved line-up use the player's role from the team page.</p>} />
          <div className="table-wrap">
            <table className="stat-table">
              <thead><tr><th>Hitter</th>{roles.map((r) => <th key={r}>{SLOT_NAMES[r]}</th>)}</tr></thead>
              <tbody>
                {pos.map((h) => (
                  <tr key={h.hitter}>
                    <td>{name(players, h.hitter)}</td>
                    {roles.map((r) => { const c = tallyCell(h.by[r]); return <td key={r}>{c.text ? <><Val tone={c.tone}>{c.text}</Val><br /><small className="muted">{c.sub}</small></> : ''}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ps.length > 0 && (
        <section className="chart">
          <Head title="Passers" help={<p>Everyone who received serve, libero included: average pass grade 0–3, perfect passes (3) and pass errors (0). <b>Attack after</b>: how the side's first attack went after this player's pass, (kills − errors) / attacks. This is where a libero's value shows; liberos are never judged on points.</p>} />
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
          <Head title="What changed from set to set" help={<p>Players who changed position or setter from one set to the next, with the number that fits what they did: attack efficiency for hitters, pass average for passers and liberos, the hitters' efficiency after their sets for setters. Only when both sets have at least 3 of them.</p>} />
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

const sum = (by: Partial<Record<SlotRole, Tally>>) => Object.values(by).reduce((s, t) => s + (t?.n ?? 0), 0);

function PlayerSets({ sides, players }: { sides: SideSet[]; players: Player[] }) {
  const ids = [...new Set(sides.flatMap((s) => [...s.perPlayer.keys(), ...s.players]))]
    .sort((a, b) => (players.find((p) => p.id === a)?.number ?? 99) - (players.find((p) => p.id === b)?.number ?? 99));
  const [pick, setPick] = useState<number | null>(null);
  const id = pick ?? ids[0];
  const tl = id == null ? [] : playerTimeline(id, sides);
  return (
    <>
      <Head title="A player's sets" help={<p>Pick a player to see their sets one after the other: the position they played (from the line-up), who set for them, their teammates, how their side's set ended, and their own numbers for that position: attack efficiency (kills − errors) / attacks for hitters, pass average for passers and liberos, the hitters' efficiency after their sets for setters. Grey: too few to judge.</p>} />
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
