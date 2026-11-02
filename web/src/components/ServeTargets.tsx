import type { ServePlan } from '../lib/serveTargets';

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Their half as our server sees it: deep row at the top (their 1 on our left), the net at the bottom. */
const ROWS = [[1, 6, 5], [2, 3, 4]];

/**
 * Serve targets on their court: side-out chance per zone (darker = better for us), then the best
 * receiver-and-zone pairs and every receiver. From the passes in their tagged matches.
 */
export function ServeTargets({ plan }: { plan: ServePlan }) {
  if (plan.passes < 10) return <p className="small muted">Serve targets need at least 10 tagged passes of theirs ({plan.passes} so far).</p>;
  const located = plan.zones.some((z) => z.n);
  const maxGain = Math.max(1, ...plan.zones.map((z) => z.gain));
  return (
    <div className="serve-targets">
      {located && (
        <figure className="serve-court" aria-label="Their side-out chance per zone">
          <div className="serve-grid">
            {ROWS.flat().map((zone) => {
              const z = plan.zones.find((x) => x.zone === zone)!;
              const strength = z.n >= 3 ? Math.max(0, Math.min(1, z.gain / maxGain)) : 0;
              return (
                <div key={zone} className={`serve-cell ${z.n < 3 ? 'thin' : ''}`} style={{ ['--s' as string]: strength.toFixed(2) }}>
                  <small>Zone {zone}</small>
                  <b>{z.n ? pct(z.sideout) : '–'}</b>
                  <small>{z.n} pass{z.n === 1 ? '' : 'es'}{z.n >= 3 && z.gain >= 0.5 ? ` · +${z.gain.toFixed(1)}` : ''}</small>
                </div>
              );
            })}
          </div>
          <div className="serve-net">net · our side below</div>
          <figcaption className="print-note">Their side-out chance when the serve is passed in each zone (average {pct(plan.base)}). Darker: better target. "+2.5": points gained per 25 serves there. Their court as seen from our serving line.</figcaption>
        </figure>
      )}
      {plan.best.length > 0 && (
        <table className="serve-best">
          <thead><tr><th>Serve at</th><th>Passes</th><th>Avg</th><th>Side-out</th><th>Per 25</th></tr></thead>
          <tbody>{plan.best.map((b, i) => (
            <tr key={i}><td><b>#{b.player.number ?? '?'}</b> in zone {b.zone}</td><td>{b.n}</td><td>{b.avg.toFixed(2)}</td><td>{pct(b.sideout)}</td><td>{b.gain >= 0 ? '+' : ''}{b.gain.toFixed(1)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <table className="serve-best">
        <thead><tr><th>Receiver</th><th>Passes</th><th>Avg</th><th>Side-out</th><th>Per 25</th></tr></thead>
        <tbody>{plan.receivers.map((r) => (
          <tr key={r.player.id}><td><b>#{r.player.number ?? '?'}</b>{r.zones[0] ? <small className="muted"> mostly zone {r.zones[0].zone}</small> : null}</td><td>{r.n}</td><td>{r.avg.toFixed(2)}</td><td>{pct(r.sideout)}</td><td>{r.gain >= 0 ? '+' : ''}{r.gain.toFixed(1)}</td></tr>
        ))}</tbody>
      </table>
      <p className="print-note">After a pass graded 0 / 1 / 2 / 3 they win the rally {plan.winAfter.map(pct).join(' / ')}. Few passes are pulled towards their team average.</p>
    </div>
  );
}
