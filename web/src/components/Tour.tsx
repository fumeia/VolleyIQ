import { t } from '../lib/i18n';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

export interface TourStep {
  /** CSS selector of the part to point at; none = a card in the middle. */
  target?: string;
  title: string;
  text: ReactNode;
  /** Left out when its part is not on the page (e.g. no practice matches, so no switch). */
  optional?: boolean;
}

const seenKey = (id: string) => `viq:tour:${id}`;
const wasSeen = (id: string) => { try { return localStorage.getItem(seenKey(id)) === '1'; } catch { return true; } };
const markSeen = (id: string) => { try { localStorage.setItem(seenKey(id), '1'); } catch { /* private mode */ } };

/**
 * A short guided tour of a page: one step at a time, the part it explains lit up.
 * Opens by itself on the first visit (per tour [id], on this device), can be skipped
 * at any step, and comes back with the "? Guide" button.
 */
export function Tour({ id, steps: all }: { id: string; steps: TourStep[] }) {
  const steps = all.filter((s) => !s.optional || (s.target && document.querySelector(s.target)));
  const [i, setI] = useState<number | null>(() => (wasSeen(id) ? null : 0));
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = i != null ? steps[i] : null;

  // Light up the step's part: scroll it into view, then follow it while the page moves.
  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    const timer = window.setTimeout(measure, 400);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(timer); window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [i, step?.target]);

  const close = () => { markSeen(id); setI(null); };
  useEffect(() => {
    if (i == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') setI((n) => (n != null && n < steps.length - 1 ? n + 1 : n));
      else if (e.key === 'ArrowLeft') setI((n) => (n ? n - 1 : n));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i]);

  if (i == null || !step) {
    return <button className="tour-open" onClick={() => setI(0)} title={t('A short tour of this page')}>? {t('Guide')}</button>;
  }
  const last = i === steps.length - 1;
  const pad = 6;
  // The card goes below the lit-up part when there is room, else above it.
  const below = !rect || rect.bottom + 220 < window.innerHeight;
  return (
    <div className="tour" role="dialog" aria-label={step.title}>
      {rect
        ? <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-dim" />}
      <div className={`tour-card ${rect ? (below ? 'below' : 'above') : 'middle'}`}
        style={rect ? (below ? { top: Math.min(rect.bottom + pad + 10, window.innerHeight - 200) } : { bottom: window.innerHeight - rect.top + pad + 10 }) : undefined}>
        <div className="tour-head">
          <b>{step.title}</b>
          <span className="small muted">{i + 1} / {steps.length}</span>
        </div>
        <div className="tour-text">{step.text}</div>
        <div className="tour-actions">
          {!last && <button className="btn-ghost small" onClick={close}>{t('Skip tour')}</button>}
          <span className="grow" />
          {i > 0 && <button className="btn small" onClick={() => setI(i - 1)}>{t('Back')}</button>}
          <button className="btn btn-primary small" onClick={() => (last ? close() : setI(i + 1))}>{last ? t('Done') : i === 0 ? t('Show me') : t('Next')}</button>
        </div>
      </div>
    </div>
  );
}
