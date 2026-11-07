import { t } from '../lib/i18n';

/** "Include practice matches" for the season views (off by default). */
export function PracticeToggle({ count, on, set }: { count: number; on: boolean; set: (v: boolean) => void }) {
  if (!count) return null;
  return (
    <label className="toggle small">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> {t('Include practice matches ({n})', { n: count })}
    </label>
  );
}
