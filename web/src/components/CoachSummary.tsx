import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * AI coach summary: a few grounded bullet points in English or German, generated
 * from the computed stats payload. Hidden unless the server has a key set up.
 */
export function CoachSummary({ stats }: { stats: unknown }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [lang, setLang] = useState<'en' | 'de'>(() => (navigator.language?.startsWith('de') ? 'de' : 'en'));
  const [bullets, setBullets] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.insightsEnabled().then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false)); }, []);
  if (!enabled) return null;

  async function generate(l: 'en' | 'de') {
    setBusy(true); setError(''); setLang(l);
    try {
      const { bullets: b } = await api.insightsSummary(stats, l);
      setBullets(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="findings coach-summary">
      <div className="row between">
        <b>✨ Coach summary</b>
        <span className="seg-mini">
          <button className={lang === 'en' ? 'on' : ''} disabled={busy} onClick={() => generate('en')}>EN</button>
          <button className={lang === 'de' ? 'on' : ''} disabled={busy} onClick={() => generate('de')}>DE</button>
        </span>
      </div>
      {!bullets && !busy && <p className="muted small">Generate a short, coach-friendly briefing from these numbers (uses AI credits).</p>}
      {busy && <p className="muted small">Writing…</p>}
      {error && <p className="error small">{error}</p>}
      {bullets && <ul>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      {bullets && <p className="muted small">AI-generated from the match stats. Check it before sharing.</p>}
    </section>
  );
}
