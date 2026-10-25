import { ROLES, type RoleCode } from './actions';

export interface RosterLine { number: number | null; name: string; role: RoleCode }

const ROLE_WORDS: Record<string, RoleCode> = {
  oh: 'OH', outside: 'OH', 'outside hitter': 'OH', aussen: 'OH', außen: 'OH',
  opp: 'OPP', opposite: 'OPP', dia: 'OPP', diagonal: 'OPP',
  mb: 'MB', middle: 'MB', 'middle blocker': 'MB', mitte: 'MB',
  s: 'S', setter: 'S', zuspiel: 'S', zuspieler: 'S', zuspielerin: 'S',
  l: 'L', libero: 'L',
  ds: 'DS', defence: 'DS', defense: 'DS',
};

/**
 * One player per line, in any common order: "7 Bea OH", "Bea Müller 7 libero",
 * "#12 Anna Meier, MB". The number is the 1-2 digit token, the role a known
 * word or code (default OH), the rest is the name.
 */
export function parseRoster(text: string, defaultRole: RoleCode = 'OH'): RosterLine[] {
  return text.split(/\n/).map((line) => line.replace(/[,;\t]/g, ' ').trim()).filter(Boolean).map((line) => {
    let number: number | null = null;
    let role: RoleCode | null = null;
    const words = line.split(/\s+/);
    const rest: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const num = w.replace(/^#/, '');
      const two = `${w} ${words[i + 1] ?? ''}`.toLowerCase();
      if (number == null && /^\d{1,2}$/.test(num)) { number = Number(num); continue; }
      if (!role && ROLE_WORDS[two]) { role = ROLE_WORDS[two]; i++; continue; }
      if (!role && (ROLE_WORDS[w.toLowerCase()] || ROLES.some((r) => r.code === w.toUpperCase()))) {
        role = ROLE_WORDS[w.toLowerCase()] ?? (w.toUpperCase() as RoleCode);
        continue;
      }
      rest.push(w);
    }
    return { number, name: rest.join(' '), role: role ?? defaultRole };
  }).filter((p) => p.name);
}
