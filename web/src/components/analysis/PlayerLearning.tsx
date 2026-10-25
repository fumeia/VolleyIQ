import { useMemo } from 'react';
import type { Match, Player, VEvent } from '../../lib/api';
import { playerStats } from '../../lib/stats';
import { playerCoaching } from './coaching';
import { PlayerTiles, roleName } from './PlayersSection';
import { avg2, eff3, enough, judge, pct, StatFigure } from './ui';

/**
 * One player's learning page: their numbers, strengths, faults and what to practise
 * (all from the tags), and how it went match by match.
 */
export function PlayerLearning({ player, players, events, matches, actions }: {
  player: Player; players: Player[]; events: VEvent[]; matches: Match[]; actions?: React.ReactNode;
}) {
  const mine = useMemo(() => events.filter((e) => e.player_id === player.id), [events, player.id]);
  const c = useMemo(() => playerCoaching(player, events, players), [player, events, players]);
  const s = playerStats([player], events)[0].stats;
  const perMatch = matches
    .map((m) => ({ m, n: mine.filter((e) => e.match_id === m.id).length, s: playerStats([player], events.filter((e) => e.match_id === m.id))[0].stats }))
    .filter((r) => r.n > 0);

  return (
    <div className="learning charts">
      <header className="pc-head learning-head">
        <span className={`num-dot role-${player.role}`}>{player.number ?? '–'}</span>
        <div className="grow"><h1>{player.name}</h1><small>{roleName(player.role)} · {mine.length} touches in {perMatch.length} match{perMatch.length === 1 ? '' : 'es'}</small></div>
        {actions}
      </header>
      {mine.length < 10 ? <p className="muted">Not enough tagged touches yet for a learning page.</p> : (
        <>
          <PlayerTiles player={player} s={s} />
          <div className="learn-cols">
            <section className="chart learn-box">
              <h3 className="tone-good">▲ Strengths</h3>
              {c.strengths.length ? <ul>{c.strengths.map((i, k) => <li key={k}>{i.text}</li>)}</ul> : <p className="muted small">Nothing stands out yet — more tagged matches will show it.</p>}
            </section>
            <section className="chart learn-box">
              <h3 className="tone-bad">▼ Faults</h3>
              {c.faults.length ? <ul>{c.faults.map((i, k) => <li key={k}>{i.text}</li>)}</ul> : <p className="muted small">No clear weak spot in the data.</p>}
            </section>
          </div>
          {c.suggestions.length > 0 && (
            <section className="chart learn-box">
              <h3>What to practise</h3>
              <ol className="learn-tips">
                {c.suggestions.map((t) => (
                  <li key={t.title}>
                    <b>{t.title}</b>
                    <span className="muted small">Because: {t.why}</span>
                    <span>{t.how}</span>
                  </li>
                ))}
              </ol>
              <p className="muted small">Suggestions are generated from the tagged touches; a coach knows the context better.</p>
            </section>
          )}
          {perMatch.length > 1 && (
            <StatFigure title="Match by match" subtitle="Green ▲ / red ▼ only with enough attempts in that match"
              rows={perMatch} rowKey={(r) => r.m.id}
              first={{ h: 'Match', cell: (r) => `${r.m.played_on ?? ''} ${r.m.opponent ?? r.m.label}`.trim() }}
              columns={[
                { h: '+/−', cell: (r) => ({ text: r.s.plusMinus > 0 ? `+${r.s.plusMinus}` : String(r.s.plusMinus), tone: player.role === 'L' ? null : judge.plusMinus(r.s.plusMinus) }) },
                { h: 'Att eff', cell: (r) => ({ text: eff3(r.s.attackEff), tone: enough(r.s.attempts, 4) ? judge.eff(r.s.attackEff) : null, title: `${r.s.kills}-${r.s.attackErrors}/${r.s.attempts}` }) },
                { h: 'Pass', cell: (r) => ({ text: avg2(r.s.recAvg), tone: enough(r.s.receptions) ? judge.passAvg(r.s.recAvg) : null, title: `${r.s.receptions} passes` }) },
                { h: 'Srv err', cell: (r) => { const v = r.s.serves ? r.s.serveErrors / r.s.serves : null; return { text: pct(v), tone: enough(r.s.serves) ? judge.serveErrPct(v) : null }; } },
              ]} />
          )}
        </>
      )}
    </div>
  );
}
