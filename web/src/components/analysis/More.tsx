import { Children, type ReactNode } from 'react';
import { t } from '../../lib/i18n';
import { useKept } from '../../lib/useKept';

/**
 * The rest of a topic's charts, behind a switch at the bottom: each topic shows its few main
 * takeaways first. Open or closed is kept per topic for the visit.
 */
export function More({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useKept(`viq:more:${id}`, false);
  if (!Children.toArray(children).length) return null;
  return (
    <>
      {open && children}
      <button className="btn-ghost small more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? `${t('Fewer charts')} ▴` : `${t('More charts')} ▾`}
      </button>
    </>
  );
}
