import { t as tr } from '../lib/i18n';
import { COURT, PASS_TARGET } from '../lib/court';

/**
 * How a pass is graded from where it went: our half seen from behind our baseline,
 * net at the top. Within 1.5 m of the setter's spot = 3, within 3 m = 2, anywhere else
 * playable = 1 (an overpass too); out of play or aced = 0. The tagger can change it.
 */
export function PassGrades() {
  const m = 1.2; // run-off drawn around the half
  const W = COURT.width + 2 * m, H = COURT.net + 2 * m;
  const X = (x: number) => x + m, Y = (y: number) => COURT.net - y + m;
  const t = { x: X(PASS_TARGET.x), y: Y(PASS_TARGET.y) };
  return (
    <figure className="pass-grades">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pass grades by where the pass went">
        <rect x={0} y={0} width={W} height={H} className="pg-out" />
        <rect x={X(0)} y={Y(COURT.net)} width={COURT.width} height={COURT.net} className="pg-1" />
        <clipPath id="pg-half"><rect x={X(0)} y={Y(COURT.net)} width={COURT.width} height={COURT.net} /></clipPath>
        <g clipPath="url(#pg-half)">
          <circle cx={t.x} cy={t.y} r={3} className="pg-2" />
          <circle cx={t.x} cy={t.y} r={1.5} className="pg-3" />
        </g>
        <rect x={X(0)} y={Y(COURT.net)} width={COURT.width} height={COURT.net} className="pg-lines" />
        <line x1={X(0)} x2={X(COURT.width)} y1={Y(COURT.net - COURT.attackLine)} y2={Y(COURT.net - COURT.attackLine)} className="pg-lines" />
        <line x1={0} x2={W} y1={Y(COURT.net)} y2={Y(COURT.net)} className="pg-net" />
        <text x={W / 2} y={Y(COURT.net) - 0.35} className="pg-label">{tr('NET')}</text>
        <text x={t.x} y={t.y + 0.4} className="pg-num">3</text>
        <text x={t.x - 2.25} y={t.y + 1.2} className="pg-num">2</text>
        <text x={X(1.6)} y={Y(2.2)} className="pg-num">1</text>
        <text x={m / 2} y={H - 0.4} className="pg-num pg-zero">0</text>
      </svg>
      <figcaption className="small">
        <span><b className="pg-k3">3</b> {tr("within 1.5 m of the setter's spot")}</span>
        <span><b className="pg-k2">2</b> {tr('within 3 m')}</span>
        <span><b className="pg-k1">1</b> {tr('elsewhere, the set is harder (an overpass too)')}</span>
        <span><b className="pg-k0">0</b> {tr('out of play, or aced')}</span>
      </figcaption>
    </figure>
  );
}
