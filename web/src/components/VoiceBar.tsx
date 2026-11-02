import { useEffect, useRef, useState } from 'react';
import { ACTION_BY_CODE, type ActionCode } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import { canListen, listen, type Listener } from '../lib/speech';
import { parseVoice, type VoiceCommand } from '../lib/voice';

const LANG_KEY = 'viq:voice-lang';
const LANGS = [{ code: 'de-CH', label: 'DE' }, { code: 'en-US', label: 'EN' }];
const POINT: Partial<Record<ActionCode, ActionCode>> = { attack: 'kill', serve: 'ace', block_touch: 'block_point' };

/**
 * Voice tagging: say who did what ("7 pass 2, 1 set, 5 kill", "our point", "their point", "undo"),
 * with or without video. Each phrase is turned into tags as soon as it is complete.
 */
export function VoiceBar({ players, onTag, onWon, onLost, onUndo, onClose }: {
  players: Player[];
  onTag: (e: Partial<VEvent>) => void; onWon: () => void; onLost: () => void; onUndo: () => void; onClose: () => void;
}) {
  const [lang, setLang] = useState(() => { try { return localStorage.getItem(LANG_KEY) ?? (navigator.language.startsWith('de') ? 'de-CH' : 'en-US'); } catch { return 'de-CH'; } });
  const [state, setState] = useState<{ listening: boolean; error?: string }>({ listening: false });
  const [interim, setInterim] = useState('');
  const [log, setLog] = useState<{ text: string; done: string[] }[]>([]);
  const listener = useRef<Listener | null>(null);
  const handlers = useRef({ onTag, onWon, onLost, onUndo, players });
  handlers.current = { onTag, onWon, onLost, onUndo, players };

  function apply(text: string) {
    const { onTag, onWon, onLost, onUndo, players } = handlers.current;
    const cmds = parseVoice(text);
    const done: string[] = [];
    // Tags of this phrase are held until its end, so "5 attack, our point" makes the attack a kill.
    let held: Extract<VoiceCommand, { kind: 'tag' }> | null = null;
    const flush = () => {
      if (!held) return;
      const p = held.jersey != null ? players.find((x) => x.active && x.number === held!.jersey) : undefined;
      onTag({ action: held.action, value: held.value, ...(p ? { player_id: p.id } : held.jersey != null ? { jersey: held.jersey } : {}) });
      done.push(`${held.jersey != null ? `#${held.jersey} ` : ''}${ACTION_BY_CODE[held.action]?.label ?? held.action}${held.value != null ? ` ${held.value}` : ''}`);
      held = null;
    };
    for (const c of cmds) {
      if (c.kind === 'tag') { flush(); held = c; continue; }
      if (c.kind === 'won') {
        const h = held as Extract<VoiceCommand, { kind: 'tag' }> | null;
        if (h && POINT[h.action]) { h.action = POINT[h.action]!; flush(); done.push('our point'); continue; }
        flush(); onWon(); done.push('our point'); continue;
      }
      flush();
      if (c.kind === 'lost') { onLost(); done.push('their point'); }
      if (c.kind === 'undo') { onUndo(); done.push('undo'); }
    }
    flush();
    setLog((l) => [{ text, done }, ...l].slice(0, 6));
  }

  async function start(code = lang) {
    try {
      listener.current = await listen(code, (text, final) => { if (final) { setInterim(''); apply(text); } else setInterim(text); }, setState);
    } catch (e) {
      setState({ listening: false, error: e instanceof Error ? e.message : 'Could not start listening' });
    }
  }
  useEffect(() => { void start(); return () => listener.current?.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function switchLang(code: string) {
    setLang(code);
    try { localStorage.setItem(LANG_KEY, code); } catch { /* storage unavailable */ }
    listener.current?.stop();
    void start(code);
  }

  if (!canListen()) return <div className="voice-bar"><span className="small error">This browser cannot listen: use Chrome, Edge or Safari, or the Android app.</span><button className="btn-ghost small" onClick={onClose}>Close</button></div>;
  return (
    <div className="voice-bar" aria-live="polite">
      <div className="row wrap voice-head">
        <span className={`voice-dot ${state.listening ? 'on' : ''}`} aria-hidden />
        <b className="small">{state.listening ? 'Listening' : 'Not listening'}</b>
        <span className="lang-switch">{LANGS.map((l) => <button key={l.code} className={lang === l.code ? 'on' : ''} onClick={() => switchLang(l.code)}>{l.label}</button>)}</span>
        {!state.listening && <button className="btn small" onClick={() => start()}>Start</button>}
        <button className="btn-ghost small" onClick={() => { listener.current?.stop(); onClose(); }}>Stop voice</button>
      </div>
      {state.error && <span className="small error">{state.error}</span>}
      <span className="voice-interim">{interim || <span className="muted small">{lang.startsWith('de') ? '«7 Annahme 2, 1 Zuspiel, 5 Punkt» · «Punkt Gegner» · «zurück»' : '"7 pass 2, 1 set, 5 kill" · "their point" · "undo"'}</span>}</span>
      {log.map((l, i) => (
        <div key={i} className={`voice-line small ${i ? 'muted' : ''}`}>
          <span>«{l.text}»</span> {l.done.length ? <b>→ {l.done.join(', ')}</b> : <span className="error">not understood</span>}
        </div>
      ))}
    </div>
  );
}
