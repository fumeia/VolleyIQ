import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Match, Player, VEvent } from '../lib/api';
import { playerStats } from '../lib/stats';
import { matchReport, seasonTrend } from './analytics';
import {
  AttackCard, BoxScoreCard, FlowCard, LeaderboardCard, PlayerCard, PointsCard, ReceptionCard, ServeCard, SeasonSummaryCard, SummaryCard, TrendsCard,
} from './Cards';
import { downloadBlob, safeFile, shareImages, svgToPng } from './exportImage';
import { fmtAvg, fmtEff, fmtPct } from './ui';

interface CardDef { id: string; label: string; node: ReactNode }

/** Shows report cards at screen size; each one exports to a 1080×1350 PNG for chats. */
export function ReportGallery({ cards, fileBase, shareText, actions }: { cards: CardDef[]; fileBase: string; shareText?: string; actions?: ReactNode }) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function render(ids: string[]) {
    const out: { name: string; blob: Blob }[] = [];
    for (const id of ids) {
      const svg = refs.current[id]?.querySelector('svg');
      if (svg) out.push({ name: safeFile(`${fileBase}-${id}.png`), blob: await svgToPng(svg) });
    }
    return out;
  }

  async function run(key: string, f: () => Promise<void>) {
    setErr('');
    setBusy(key);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="report">
      <div className="report-actions">
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run('all', async () => shareImages(await render(cards.map((c) => c.id)), shareText))}>
          {busy === 'all' ? 'Preparing images…' : `📤 Share all ${cards.length} images`}
        </button>
        {actions}
      </div>
      {err && <p className="error small">{err}</p>}
      <div className="report-grid">
        {cards.map((c) => (
          <figure key={c.id} className="report-card">
            <div ref={(el) => { refs.current[c.id] = el; }} className="report-svg">{c.node}</div>
            <figcaption>
              <span>{c.label}</span>
              <span className="row">
                <button className="btn-ghost small" disabled={!!busy} onClick={() => run(c.id, async () => {
                  const [f] = await render([c.id]);
                  downloadBlob(f.blob, f.name);
                })}>Save</button>
                <button className="btn small-btn" disabled={!!busy} onClick={() => run(c.id, async () => shareImages(await render([c.id]), shareText))}>
                  {busy === c.id ? '…' : 'Share'}
                </button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

type MatchLike = Pick<Match, 'label' | 'opponent' | 'played_on' | 'team_name'>;

export function MatchReportView({ match, players, events, actions }: { match: MatchLike; players: Player[]; events: VEvent[]; actions?: ReactNode }) {
  const rep = useMemo(() => matchReport(match, players, events), [match, players, events]);
  if (!rep.confirmed.length) return <p className="muted">No confirmed tags yet. Tag the match (or review the AI suggestions) to build the report.</p>;
  const context = rep.title;
  const cards: CardDef[] = [
    { id: 'summary', label: 'Match summary', node: <SummaryCard rep={rep} /> },
    { id: 'score-flow', label: 'Score flow', node: <FlowCard rep={rep} /> },
    { id: 'points', label: 'How points were won/lost', node: <PointsCard rep={rep} /> },
    { id: 'attack', label: 'Attack map', node: <AttackCard rep={rep} players={players} /> },
    { id: 'serve', label: 'Serve map', node: <ServeCard rep={rep} players={players} /> },
    { id: 'reception', label: 'Reception', node: <ReceptionCard rep={rep} players={players} /> },
    { id: 'box-score', label: 'Box score', node: <BoxScoreCard rep={rep} /> },
    ...rep.rows.filter((r) => r.count >= 3).map((r) => ({
      id: `player-${r.player.number ?? r.player.id}`,
      label: `#${r.player.number ?? '–'} ${r.player.name}`,
      node: <PlayerCard row={r} events={rep.confirmed} players={players} context={context} />,
    })),
  ];
  return <ReportGallery cards={cards} fileBase={rep.title} shareText={`${rep.title} ${rep.subtitle}`.trim()} actions={actions} />;
}

type SeasonMatch = Pick<Match, 'id' | 'label' | 'opponent' | 'played_on'>;

export function SeasonReportView({ title, matches, players, events, actions }: { title: string; matches: SeasonMatch[]; players: Player[]; events: VEvent[]; actions?: ReactNode }) {
  const confirmed = useMemo(() => events.filter((e) => !('status' in e) || e.status === 'confirmed'), [events]);
  const rows = useMemo(() => playerStats(players, confirmed).filter((r) => r.count > 0), [players, confirmed]);
  if (!confirmed.length) return <p className="muted">No confirmed tags for this team yet.</p>;
  const ordered = [...matches].sort((a, b) => (a.played_on ?? '').localeCompare(b.played_on ?? '') || a.id - b.id);
  const cards: CardDef[] = [
    { id: 'season', label: 'Season summary', node: <SeasonSummaryCard title={title} matches={ordered} events={confirmed} rows={rows} /> },
    {
      id: 'trends', label: 'Trends', node: (
        <TrendsCard title={title} panels={[
          { label: 'Attack efficiency', fmt: fmtEff, points: seasonTrend(ordered, confirmed, (s) => s.attackEff), domain: [-1, 1] },
          { label: 'Kill %', fmt: fmtPct, points: seasonTrend(ordered, confirmed, (s) => s.killPct), domain: [0, 1] },
          { label: 'Serve in %', fmt: fmtPct, points: seasonTrend(ordered, confirmed, (s) => s.serveInPct), domain: [0, 1] },
          { label: 'Pass average', fmt: fmtAvg, points: seasonTrend(ordered, confirmed, (s) => s.recAvg), domain: [0, 3] },
        ]} />
      ),
    },
    { id: 'leaderboard', label: 'Leaderboard', node: <LeaderboardCard title={title} rows={rows} /> },
    { id: 'box-score', label: 'Season box score', node: <BoxScoreCard rep={{ rows, title }} subtitle={`All ${ordered.length} matches`} /> },
    ...rows.filter((r) => r.count >= 5).map((r) => ({
      id: `player-${r.player.number ?? r.player.id}`,
      label: `#${r.player.number ?? '–'} ${r.player.name}`,
      node: <PlayerCard row={r} events={confirmed} players={players} context={`${title} season`} />,
    })),
  ];
  return <ReportGallery cards={cards} fileBase={`${title}-season`} shareText={`${title} season report`} actions={actions} />;
}
