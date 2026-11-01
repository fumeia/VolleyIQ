import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Icon } from './Icon';

/** The ⋮ menu at the top right: About (version, updates) and log out. */
export function MoreMenu({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className={`more-menu ${className}`} ref={box}>
      <button className="btn-ghost more-btn" aria-label="More" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="more" /></button>
      {open && (
        <div className="more-list" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); nav('/about'); }}>About &amp; updates</button>
          <button role="menuitem" onClick={() => api.logout().then(() => location.reload())}>Log out</button>
        </div>
      )}
    </div>
  );
}
