import { useMemo } from 'react';
import { ROLES } from '../../lib/actions';
import type { Player, VEvent } from '../../lib/api';
import { playerStats, type StatLine } from '../../lib/stats';
import { who } from './AttackSection';
import { ERROR_TYPES } from './ErrorsSection';
import { insightsFor } from './insights';
import { avg2, eff3, enough, judge, pct, PlayBtn, plural, Val, type Tone } from './ui';

export const roleName = (code: string) => ROLES.find((r) => r.code === code)?.label ?? code;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="pc-tile">
      <span className="pc-label">{label}</span>
      <span className="pc-value"><Val tone={tone}>{value}</Val></span>
      {sub && <span className="pc-sub">{sub}</span>}
    </div>
  );
}

/** The key numbers of one player (only the skills they actually played). */
export function PlayerTiles({ player: p, s }: { player: Player; s: StatLine }) {
  return (
    <div className="pc-tiles">
      <Tile label="+/−" value={s.plusMinus > 0 ? `+${s.plusMinus}` : String(s.plusMinus)} sub={`${s.points} won · ${s.errors} lost`} tone={p.role === 'L' ? null : judge.plusMinus(s.plusMinus)} />
      {s.attempts > 0 && <Tile label="Attack eff" value={eff3(s.attackEff)} sub={`${s.kills}-${s.attackErrors}/${s.attempts}`} tone={enough(s.attempts, 3) ? judge.eff(s.attackEff) : null} />}
      {s.receptions > 0 && <Tile label="Pass avg" value={avg2(s.recAvg)} sub={`${s.receptions} passes`} tone={enough(s.receptions) ? judge.passAvg(s.recAvg) : null} />}
      {s.serves > 0 && <Tile label="Serve err" value={pct(s.serves ? s.serveErrors / s.serves : null)} sub={s.aces ? `${s.serves} · ${plural(s.aces, 'ace')}` : plural(s.serves, 'serve')} tone={enough(s.serves) ? judge.serveErrPct(s.serves ? s.serveErrors / s.serves : null) : null} />}
      {s.digs + s.digErrors > 0 && <Tile label="Digs" value={String(s.digs)} sub={plural(s.digErrors, 'error')} />}
      {s.sets > 0 && <Tile label="Sets" value={String(s.sets)} sub={s.bumpSets ? `${s.bumpSets} bump sets` : plural(s.assists, 'assist')} />}
      {s.blockPoints + s.blockTouches > 0 && <Tile label="Block pts" value={String(s.blockPoints)} sub={plural(s.blockTouches, 'touch', 'touches')} />}
    </div>
  );
}

/** One scorecard per player: the key numbers, and what went well / what to work on. */
export function PlayersSection({ players, events }: { players: Player[]; events: VEvent[] }) {
  const rows = useMemo(() => playerStats(players, events).filter((r) => r.count >= 5), [players, events]);
  if (!rows.length) return <p className="muted small">Not enough tags per player yet.</p>;
  return (
    <div className="charts">
      <p className="muted small">Green ▲ = good, red ▼ = to work on (judged only with enough attempts). Sorted by points won.</p>
      <div className="pc-grid">
        {rows.map(({ player: p, stats: s }) => {
          const mine = events.filter((e) => e.player_id === p.id);
          const items = insightsFor(mine, events, 'player', players);
          const good = items.filter((i) => i.tone === 'good').slice(0, 3);
          const bad = items.filter((i) => i.tone === 'bad').slice(0, 3);
          return (
            <article key={p.id} className="chart player-card">
              <header className="pc-head">
                <span className={`num-dot role-${p.role}`}>{p.number ?? '–'}</span>
                <div className="grow"><b>{p.name}</b><small>{roleName(p.role)} · {mine.length} touches</small></div>
                <PlayBtn list={mine.filter((e) => ['kill', 'ace', 'block_point'].includes(e.action))} label="Points" />
                <PlayBtn list={mine.filter((e) => ERROR_TYPES.some((t) => t.test(e)))} label="Errors" />
              </header>
              <PlayerTiles player={p} s={s} />
              {(good.length > 0 || bad.length > 0) && (
                <div className="pc-notes">
                  {good.map((i, k) => <p key={`g${k}`} className="tone-good">▲ {i.text}</p>)}
                  {bad.map((i, k) => <p key={`b${k}`} className="tone-bad">▼ {i.text}</p>)}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export { who };
