// Court zones as seen from behind the attacking team: front row 4-3-2 at the net, back row 5-6-1.
export const ZONE_LAYOUT = [[4, 3, 2], [5, 6, 1]];

interface Props {
  counts?: number[];          // heat values indexed by zone (1..6)
  onPick?: (zone: number) => void;
  selected?: number | null;
  compact?: boolean;
}

export function ZoneCourt({ counts, onPick, selected, compact }: Props) {
  const max = counts ? Math.max(1, ...counts.slice(1)) : 1;
  const total = counts ? counts.slice(1).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className={`court ${compact ? 'court-compact' : ''}`}>
      <div className="court-net">NET</div>
      {ZONE_LAYOUT.map((row, i) => (
        <div className="court-row" key={i}>
          {row.map((z) => {
            const v = counts?.[z] ?? 0;
            const heat = counts ? v / max : 0;
            const Tag = onPick ? 'button' : 'div';
            return (
              <Tag
                key={z}
                type={onPick ? 'button' : undefined}
                className={`court-zone ${selected === z ? 'is-selected' : ''}`}
                style={counts ? { background: `rgba(249, 115, 22, ${0.08 + heat * 0.72})` } : undefined}
                onClick={onPick ? () => onPick(z) : undefined}
              >
                <span className="court-zone-label">Zone {z}</span>
                {counts && (
                  <span className="court-zone-value">
                    {v}
                    {total > 0 && <small> {Math.round((v / total) * 100)}%</small>}
                  </span>
                )}
              </Tag>
            );
          })}
        </div>
      ))}
    </div>
  );
}
