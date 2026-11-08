import { useMemo, useState } from 'react';
import { ATTACKS, SERVES } from '../../lib/sequence';
import { CourtMaps } from '../CourtMaps';
import { AttackSection } from './AttackSection';
import { BLOCKS, BlockSection } from './BlockSection';
import { SetterView } from './SetterView';
import { ServePassSection } from './ServePassSection';
import type { Match, Player, VEvent } from '../../lib/api';
import { playerStats, type StatLine } from '../../lib/stats';
import { LineChart, SERIES } from '../../charts/Charts';
import { playerCoaching } from './coaching';
import { PlayerTiles, roleName } from './PlayersSection';
import { avg2, eff3, judge, pct, StatFigure, sample } from './ui';

/**
 * One player's learning page: their numbers, strengths, faults and what to practise
 * (all from the tags), and how it went match by match.
 */
export function PlayerLearning({ player, players, events, matches, actions, showTips = false, tipsToggle, split }: {
  player: Player; players: Player[]; events: VEvent[]; matches: Match[]; actions?: React.ReactNode;
  /** All the team's matches and tags, practice included, for "In matches and in practice" (also when practice is switched off above). */
  split?: { events: VEvent[]; matches: Match[] };
  /** Show the pre-written practice tips (a team setting). [tipsToggle] is the coach's switch for it. */
  showTips?: boolean; tipsToggle?: React.ReactNode;
}) {
  const mine = useMemo(() => events.filter((e) => e.player_id === player.id), [events, player.id]);
  const c = useMemo(() => playerCoaching(player, events, players), [player, events, players]);
  const s = playerStats([player], events)[0].stats;
  // Charts of this player only, for the skills they have touches in.
  const charts = ([
    ['attack', 'Attack', mine.some((e) => ATTACKS.includes(e.action))],
    ['servepass', 'Serve & pass', mine.some((e) => SERVES.includes(e.action) || e.action === 'receive')],
    ['setting', 'Setting', player.role === 'S' && mine.some((e) => e.action === 'set' && e.x != null)],
    ['block', 'Block', mine.some((e) => BLOCKS.includes(e.action))],
    ['court', 'Court maps', mine.some((e) => e.x != null)],
  ] as const).filter(([, , has]) => has);
  const [chart, setChart] = useState<string | null>(null);
  const shown = charts.find(([k]) => k === chart)?.[0] ?? charts[0]?.[0];
  const perMatch = matches
    .map((m) => ({ m, n: mine.filter((e) => e.match_id === m.id).length, s: playerStats([player], events.filter((e) => e.match_id === m.id))[0].stats }))
    .filter((r) => r.n > 0)
    .sort((a, b) => (a.m.played_on ?? '').localeCompare(b.m.played_on ?? '') || a.m.id - b.m.id);
  // Real matches against practice matches: does it carry over into games?
  const kinds = useMemo(() => {
    if (!split) return [];
    const practice = new Set(split.matches.filter((m) => m.practice).map((m) => m.id));
    return ([['Matches', false], ['Practice', true]] as const).map(([label, isPractice]) => {
      const evs = split.events.filter((e) => practice.has(e.match_id) === isPractice);
      const ids = new Set(evs.filter((e) => e.player_id === player.id).map((e) => e.match_id));
      return { label, n: ids.size, touches: evs.filter((e) => e.player_id === player.id).length, s: playerStats([player], evs)[0].stats };
    }).filter((k) => k.touches > 0);
  }, [split, player]);
  // The trend over the season: one small chart per skill the player has in two or more matches.
  const trendName = (x: number) => { const m = perMatch[x - 1]?.m; return m ? (m.opponent ?? m.label) : String(x); };
  const trends = ([
    { key: 'att', title: 'Attack efficiency per match', sub: '(kills − errors) / attacks, in date order', y: (st: StatLine) => (st.attempts >= 2 ? st.attackEff : null), fmt: (v: number) => eff3(v), dom: undefined as [number, number] | undefined, ref: 0 },
    { key: 'pass', title: 'Pass average per match', sub: 'Receive grade 0–3, in date order', y: (st: StatLine) => (st.receptions >= 2 ? st.recAvg : null), fmt: (v: number) => v.toFixed(1), dom: [0, 3] as [number, number], ref: undefined },
    { key: 'srv', title: 'Serve errors per match', sub: 'Share of serves that were errors, in date order', y: (st: StatLine) => (st.serves >= 2 ? st.serveErrors / st.serves : null), fmt: (v: number) => pct(v), dom: [0, 1] as [number, number], ref: undefined },
  ]).map((t) => ({ ...t, points: perMatch.map((r, i) => ({ x: i + 1, y: t.y(r.s) })).filter((p): p is { x: number; y: number } => p.y != null) }))
    .filter((t) => t.points.length >= 2);

  return (
    <div className="learning charts">
      <header className="pc-head learning-head">
        <span className={`num-dot role-${player.role}`}>{player.number ?? '–'}</span>
        <div className="grow"><h1>{player.name}</h1><small>{roleName(player.role)} · {mine.length} touches in {perMatch.length} match{perMatch.length === 1 ? '' : 'es'}</small></div>
        {actions}
      </header>
      {kinds.length > 1 && (
        <StatFigure title="In matches and in practice" subtitle="The same numbers from real matches and from practice matches: does it carry over into games?"
          rows={kinds} rowKey={(r) => r.label}
          first={{ h: '', cell: (r) => `${r.label} (${r.n})` }}
          columns={[
            { h: 'Touches', cell: (r) => r.touches },
            { h: '+/−', cell: (r) => ({ text: r.s.plusMinus > 0 ? `+${r.s.plusMinus}` : String(r.s.plusMinus), tone: player.role === 'L' ? null : judge.plusMinus(r.s.plusMinus) }) },
            { h: 'Att eff', cell: (r) => ({ text: eff3(r.s.attackEff), tone: sample(judge.eff(r.s.attackEff), r.s.attempts, 4), title: `${r.s.kills}-${r.s.attackErrors}/${r.s.attempts}` }) },
            { h: 'Pass', cell: (r) => ({ text: avg2(r.s.recAvg), tone: sample(judge.passAvg(r.s.recAvg), r.s.receptions), title: `${r.s.receptions} passes` }) },
            { h: 'Srv err', cell: (r) => { const v = r.s.serves ? r.s.serveErrors / r.s.serves : null; return { text: pct(v), tone: sample(judge.serveErrPct(v), r.s.serves), title: `${r.s.serveErrors} of ${r.s.serves}` }; } },
            { h: 'Aces', cell: (r) => r.s.aces },
          ]} />
      )}
      {mine.length < 10 ? <><p className="muted">Not enough tagged touches yet for a learning page.</p>{tipsToggle}</> : (
        <>
          <PlayerTiles player={player} s={s} />
          <div className="learn-cols" data-tour="learn">
            <section className="chart learn-box">
              <h3 className="tone-good">▲ Strengths</h3>
              {c.strengths.length ? <ul>{c.strengths.map((i, k) => <li key={k}>{i.text}</li>)}</ul> : <p className="muted small">Nothing stands out yet. More tagged matches will show more.</p>}
            </section>
            <section className="chart learn-box">
              <h3 className="tone-bad">▼ Faults</h3>
              {c.faults.length ? <ul>{c.faults.map((i, k) => <li key={k}>{i.text}</li>)}</ul> : <p className="muted small">No clear weak spot in the data.</p>}
            </section>
          </div>
          {tipsToggle}
          {showTips && c.suggestions.length > 0 && (
            <section className="chart learn-box">
              <h3>What to practise</h3>
              <p className="tips-warning small">⚠ These tips are pre-written suggestions, drafted with AI when VolleyIQ was built, and picked automatically from the tagged touches. Nothing is generated live, and they are not a coach's assessment.</p>
              <ol className="learn-tips">
                {c.suggestions.map((t) => (
                  <li key={t.title}>
                    <b>{t.title}</b>
                    <span className="muted small">Because: {t.why}</span>
                    <span>{t.how}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {trends.map((t) => (
            <LineChart key={t.key} title={t.title} subtitle={t.sub}
              series={[{ name: t.title.replace(' per match', ''), color: SERIES.blue, points: t.points }]}
              xTitle="Match" yTitle="" yFmt={t.fmt} xFmt={trendName} categorical yDomain={t.dom} {...(t.ref != null ? { refLine: { y: t.ref, label: '0' } } : {})} />
          ))}
          {perMatch.length > 1 && (
            <StatFigure title="Match by match" subtitle="Green ▲ / red ▼ only with enough attempts in that match"
              rows={perMatch} rowKey={(r) => r.m.id}
              first={{ h: 'Match', cell: (r) => `${r.m.played_on ?? ''} ${r.m.opponent ?? r.m.label}`.trim() }}
              columns={[
                { h: '+/−', cell: (r) => ({ text: r.s.plusMinus > 0 ? `+${r.s.plusMinus}` : String(r.s.plusMinus), tone: player.role === 'L' ? null : judge.plusMinus(r.s.plusMinus) }) },
                { h: 'Att eff', cell: (r) => ({ text: eff3(r.s.attackEff), tone: sample(judge.eff(r.s.attackEff), r.s.attempts, 4), title: `${r.s.kills}-${r.s.attackErrors}/${r.s.attempts}` }) },
                { h: 'Pass', cell: (r) => ({ text: avg2(r.s.recAvg), tone: sample(judge.passAvg(r.s.recAvg), r.s.receptions), title: `${r.s.receptions} passes` }) },
                { h: 'Srv err', cell: (r) => { const v = r.s.serves ? r.s.serveErrors / r.s.serves : null; return { text: pct(v), tone: sample(judge.serveErrPct(v), r.s.serves) }; } },
              ]} />
          )}
          {charts.length > 0 && (
            <section className="player-charts">
              <h2 className="section-title">Charts</h2>
              <div className="stats-sections">
                {charts.map(([k, label]) => (
                  <button key={k} className={`sec-btn sec-${k} ${shown === k ? 'on' : ''}`} onClick={() => setChart(k)} aria-pressed={shown === k}>{label}</button>
                ))}
              </div>
              {shown === 'attack' && <AttackSection players={players} events={events} only={player.id} />}
              {shown === 'servepass' && <ServePassSection players={players} events={events} only={player.id} />}
              {shown === 'setting' && <div className="charts"><SetterView players={players} events={events} only={player.id} /></div>}
              {shown === 'block' && <BlockSection players={players} events={events} only={player.id} />}
              {shown === 'court' && <CourtMaps players={players} events={events} only={player.id} />}
            </section>
          )}
        </>
      )}
    </div>
  );
}
