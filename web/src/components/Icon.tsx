/** Plain line icons for the navigation (24 × 24, drawn in the text colour). */
const PATHS: Record<string, string> = {
  home: 'M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z',
  teams: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5.5 8.5c.4-3 2.7-5 5.5-5s5.1 2 5.5 5M16 10.5a2.5 2.5 0 1 0 0-5M17.5 14.6c1.8.5 3 2.3 3.2 4.9',
  tag: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h9A1.5 1.5 0 0 1 16 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 17.5zM16 10l4-2.5v9L16 14M10 9v6M7 12h6',
  stats: 'M4 20h16M6.5 20v-6M11 20V8M15.5 20v-9M20 20V5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5v.5',
  live: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M10 2.5h4M12 2.5V5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-3.6l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-1.8-3.1 1.6-1.2a7 7 0 0 1 0-3L3 9.3l1.8-3.1 1.9.7a7 7 0 0 1 1.7-1l.3-2h3.6l.3 2a7 7 0 0 1 1.7 1l1.9-.7L21 9.3l-1.6 1.2a7 7 0 0 1 0 3z',
  calendar: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={name === 'more' ? 3 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
