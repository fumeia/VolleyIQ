/** Light (the default), dark, or whatever the device uses. Kept per device. */
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'viq:theme';

export function loadTheme(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'system' ? v : 'light'; } catch { return 'light'; }
}

/** Sets the theme on the page (and the colour of the phone's status bar). */
export function applyTheme(choice: ThemeChoice = loadTheme()) {
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1626' : '#11294a');
}

export function saveTheme(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice); } catch { /* private mode */ }
  applyTheme(choice);
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (loadTheme() === 'system') applyTheme(); });
