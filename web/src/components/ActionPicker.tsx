import { ACTION_BY_CODE, SHORT, SKILLS, type ActionCode } from '../lib/actions';

/** Actions as one row per skill (serve, pass, set, attack, block, defence), outcomes side by side. */
export function ActionPicker({ value, onPick }: { value?: ActionCode | null; onPick: (code: ActionCode) => void }) {
  return (
    <div className="action-picker">
      {SKILLS.map((row) => (
        <div key={row.label} className="skill-row">
          <span className="skill-label">{row.label}</span>
          {row.codes.map((code) => {
            const a = ACTION_BY_CODE[code];
            const tone = a.score === 'us' ? 'points' : a.score === 'them' ? 'errors' : code === 'receive' ? 'receive' : 'actions';
            return (
              <button key={code} className={`act act-${tone} ${value === code ? 'is-on' : ''}`} onClick={() => onPick(code)}>
                {code === 'receive' ? 'Receive' : SHORT[code] ?? a.short}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
