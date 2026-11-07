import { useMemo, useState } from 'react';
import type { Match, Player, VEvent } from '../../lib/api';
import { orderAt } from '../../lib/rotation';
import { changes, findings, playerTimeline, setterHitter, sideSets, SLOT_NAMES, together, who, type SideSet } from '../../lib/practiceAnalysis';
import type { StatLine } from '../../lib/stats';
import { avg2, eff3, enough, judge, pct, Val } from './ui';

type View = 'sets' | 'combos' | 'players';

/**
 * A practice match: both sides are ours, mixed anew each set. Instead of "us" and "them": each
 * set's two sides next to each other, what the data says about the combinations, and each
 * player's sets one after the other.
 */
export function PracticeSection({ match, players, events }: { match: Match; players: Player[]; events: VEvent[] }) {
  const sides = useMemo(() => sideSets(match, players, events), [match, players, events]);
  const [view, setView] = useState<View>('sets');
  if (!sides.length) return <p className="muted small">No sides set yet: pick who plays on which side for each set on the tag screen.</p>;
  return (
    <div className="charts practice-analysis">
      <p className="muted small">Practice match: both sides are your own players. Each side is named after who set for it in that set.</p>
      <div className="segmented" role="tablist">
        {([['sets', 'Set by set'], ['combos', 'Combinations'], ['players', 'Players']] as [View, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      {view === 'sets' && <SetCards sides={sides} players={players} />}
      {view === 'combos' && <Combos sides={sides} players={players} events={events.filter((e) => e.match_id === match.id)} />}
      {view === 'players' && <PlayerSets sides={sides} players={players} />}
    </div>
  );
}

const name = (players: Player[], id: number | null | undefined) => who(players.find((p) => p.id === id));

/** The line-up as the court: front row 4 3 2, back row 5 6 1. */
function MiniCourt({ side, players }: { side: SideSet; players: Player[] }) {
  if (!side.lineup) {
    return <ul className="practice-roster">{side.players.map((id) => <li key={id}>{name(players, id)}{side.roleOf.get(id) ? <small> {side.roleOf.get(id)}</small> : null}</li>)}</ul>;
  }
  const order = orderAt(side.lineup, 0);
  const cell = (pos: number) => {
    const id = order[pos - 1];
    return (
      <span key={pos} className={`mini-pos ${id === side.setter ? 'is-setter' : ''}`}>
        <b>{id == null ? '–' : `#${players.find((p) => p.id === id)?.number ?? '–'}`}</b>
        <small>{id == null ? '' : players.find((p) => p.id === id)?.name.split(' ')[0]}{id != null && side.roleOf.get(id) ? ` · ${side.roleOf.get(id)}` : ''}</small>
      </span>
    );
  };
  return (
    <div className="mini-court" aria-label={`Line-up of ${side.label}`}>
      {[4, 3, 2, 5, 6, 1].map(cell)}
      {side.lineup.libero != null && <span className="mini-libero">Libero {name(players, side.lineup.libero)}</span>}
    </div>
  );
}

interface Row { label: string; cell: (s: SideSet) => { text: string; tone?: ReturnType<typeof judge.eff>; title?: string } }
const ROWS: Row[] = [
  { label: 'Points', cell: (s) => ({ text: String(s.pointsFor) }) },
  { label: 'Side-out', cell: (s) => ({ text: pct(s.sideoutPct), tone: judge.sideout(s.sideoutPct) }) },
  { label: 'Break', cell: (s) => ({ text: pct(s.breakPct), tone: judge.break(s.breakPct) }) },
  { label: 'Attack eff', cell: (s) => ({ text: eff3(s.line.attackEff), tone: enough(s.line.attempts) ? judge.eff(s.line.attackEff) : null, title: `${s.line.kills} kills, ${s.line.attackErrors} errors, ${s.line.attempts} attacks` }) },
  { label: 'Pass avg', cell: (s) => ({ text: avg2(s.line.recAvg), tone: enough(s.line.receptions) ? judge.passAvg(s.line.recAvg) : null, title: `${s.line.receptions} passes` }) },
  { label: 'Aces / serve err', cell: (s) => ({ text: `${s.line.aces} / ${s.line.serveErrors}` }) },
  { label: 'Block points', cell: (s) => ({ text: String(s.line.blockPoints) }) },
  { label: 'Errors', cell: (s) => ({ text: String(s.line.errors) }) },
];

function SetCards({ sides, players }: { sides: SideSet[]; players: Player[] }) {
  const sets = [...new Set(sides.map((s) => s.set))];
  return (
    <>
      {sets.map((set) => {
        const two = sides.filter((s) => s.set === set);
        return (
          <section key={set} className="chart practice-set" aria-label={`Set ${set}`}>
            <div className="row between">
              <b>Set {set}</b>
              <span className="practice-set-score">{two.map((s) => s.pointsFor).join(' : ')}</span>
            </div>
            <div className="practice-two">
              {two.map((s) => (
                <div key={s.side} className={`practice-col side-${s.side}`}>
                  <b className="practice-col-head">{s.label}{s.pointsFor > s.pointsAgainst ? ' · won' : ''}</b>
                  <MiniCourt side={s} players={players} />
                </div>
              ))}
            </div>
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
          </section>
        );
      })}
    </>
  );
}

const line = (l: StatLine) => [
  l.attempts ? `attack ${l.kills}-${l.attackErrors}/${l.attempts}` : null,
  l.receptions ? `pass ${avg2(l.recAvg, 1)} (${l.receptions})` : null,
  l.serves ? `serve ${l.aces} ace${l.aces === 1 ? '' : 's'}, ${l.serveErrors} err` : null,
  l.sets ? `${l.sets} set${l.sets === 1 ? '' : 's'} played` : null,
  l.blockPoints ? `${l.blockPoints} block pt` : null,
  l.digs ? `${l.digs} digs` : null,
].filter(Boolean).join(' · ') || 'no touches tagged';

function SidePlayers({ side, players }: { side: SideSet; players: Player[] }) {
  const ids = [...side.perPlayer.keys()].sort((a, b) => (side.perPlayer.get(b)!.plusMinus - side.perPlayer.get(a)!.plusMinus));
  const rot = side.rotations.filter((r) => r.serving + r.receiving > 0);
  return (
    <div className="practice-side-detail">
      <b className="small">{side.label}</b>
      <ul className="practice-players">
        {ids.map((id) => {
          const l = side.perPlayer.get(id)!;
          return (
            <li key={id}>
              <span>{name(players, id)}{side.roleOf.get(id) ? <small className="muted"> {SLOT_NAMES[side.roleOf.get(id)!]}</small> : null}</span>
              <span className="small muted">{line(l)}</span>
              <Val tone={judge.plusMinus(l.plusMinus)}>{l.plusMinus > 0 ? '+' : ''}{l.plusMinus}</Val>
            </li>
          );
        })}
      </ul>
      {rot.length > 0 && (
        <p className="small muted">Rotations (setter's position): {rot.map((r) => `S${r.pos} ${r.sideOuts + r.breaks}/${r.serving + r.receiving}`).join(' · ')}</p>
      )}
    </div>
  );
}

function Combos({ sides, players, events }: { sides: SideSet[]; players: Player[]; events: VEvent[] }) {
  const f = useMemo(() => findings(players, sides, events), [players, sides, events]);
  const pairs = useMemo(() => setterHitter(events).sort((a, b) => b.attempts - a.attempts), [events]);
  const tg = useMemo(() => together(sides).filter((t) => t.sets >= 2).sort((a, b) => b.diff - a.diff), [sides]);
  const ch = useMemo(() => changes(players, sides), [players, sides]);
  const setters = [...new Set(pairs.map((p) => p.setter))];
  const hitters = [...new Set(pairs.map((p) => p.hitter))].sort((a, b) => pairs.filter((p) => p.hitter === b).reduce((s, p) => s + p.attempts, 0) - pairs.filter((p) => p.hitter === a).reduce((s, p) => s + p.attempts, 0));
  return (
    <>
      {f.length > 0 && (
        <section className="findings">
          <b>What the data says</b>
          <ul>{f.map((x, i) => <li key={i}><Val tone={x.tone === 'info' ? null : x.tone}>{x.text}</Val></li>)}</ul>
          <p className="small muted">One practice match is a small sample: take these as hints to try again, not as verdicts.</p>
        </section>
      )}
      {pairs.length > 0 && (
        <section className="chart">
          <b>Setter and hitter</b>
          <p className="small muted">Attacks right after each setter's set: kills-errors / attacks. Empty: they did not play together.</p>
          <div className="table-wrap">
            <table className="stat-table">
              <thead><tr><th>Hitter</th>{setters.map((s) => <th key={s}>{name(players, s)} sets</th>)}</tr></thead>
              <tbody>
                {hitters.map((h) => (
                  <tr key={h}>
                    <td>{name(players, h)}</td>
                    {setters.map((s) => {
                      const p = pairs.find((x) => x.setter === s && x.hitter === h);
                      return <td key={s}>{p ? <Val tone={p.attempts >= 4 ? judge.eff(p.eff) : null} title={`efficiency ${eff3(p.eff)}`}>{p.kills}-{p.errors}/{p.attempts}</Val> : ''}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tg.length > 0 && (
        <section className="chart">
          <b>Who played well together</b>
          <p className="small muted">Pairs on the same side in at least 2 sets: sets won and the side's point difference in them.</p>
          <ul className="practice-players">
            {[...tg.slice(0, 5), ...(tg.length > 8 ? tg.slice(-3) : tg.slice(5))].map((t) => (
              <li key={`${t.a}:${t.b}`}>
                <span>{name(players, t.a)} + {name(players, t.b)}</span>
                <span className="small muted">{t.won} of {t.sets} sets won</span>
                <Val tone={judge.plusMinus(t.diff)}>{t.diff > 0 ? '+' : ''}{t.diff}</Val>
              </li>
            ))}
          </ul>
        </section>
      )}
      {ch.length > 0 && (
        <section className="chart">
          <b>What changed from set to set</b>
          <p className="small muted">A player's +/- (points scored minus errors) before and after a switch of position, setter or teammates.</p>
          <ul className="practice-changes">
            {ch.slice(0, 12).map((c, i) => (
              <li key={i}>
                <span><b>{name(players, c.player)}</b> <small className="muted">set {c.from.set} → {c.to.set}</small></span>
                <span className="small">{c.what.join(' · ')}</span>
                <span className="small">
                  <Val tone={judge.plusMinus(c.from.line.plusMinus)}>{c.from.line.plusMinus}</Val> → <Val tone={judge.plusMinus(c.to.line.plusMinus)}>{c.to.line.plusMinus}</Val>
                  <span className="muted"> ({line(c.from.line)} → {line(c.to.line)})</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!f.length && !pairs.length && !tg.length && !ch.length && <p className="muted small">Not enough tagged yet to compare combinations.</p>}
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
      <div className="chips">
        {ids.map((x) => <button key={x} className={`chip ${x === id ? 'on' : ''}`} onClick={() => setPick(x)}>{name(players, x)}</button>)}
      </div>
      <ol className="practice-timeline">
        {tl.map((s) => {
          const mates = s.side.players.filter((x) => x !== id);
          return (
            <li key={s.set} className="chart">
              <div className="row between">
                <b>Set {s.set}{s.role ? ` · ${SLOT_NAMES[s.role]}` : ''}</b>
                <span className="small">{s.side.pointsFor} : {s.side.pointsAgainst}{s.won == null ? '' : s.won ? ' won' : ' lost'}</span>
              </div>
              <p className="small muted">
                {s.setter === id ? 'Setting' : s.setter != null ? `${name(players, s.setter)} setting` : 'Setter unknown'}
                {mates.length ? ` · with ${mates.filter((m) => m !== s.setter).map((m) => name(players, m)).join(', ')}` : ''}
              </p>
              <div className="row between">
                <span className="small">{line(s.line)}</span>
                <Val tone={judge.plusMinus(s.line.plusMinus)}>+/- {s.line.plusMinus > 0 ? '+' : ''}{s.line.plusMinus}</Val>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
