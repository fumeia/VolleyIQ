import { useEffect, useRef, useState } from 'react';
import { actionLabel, type ActionCode } from '../lib/actions';
import type { Player, VEvent } from '../lib/api';
import type { PlayerHandle } from './VideoPlayer';
import { canListen, listen, type Listener } from '../lib/speech';
import { parseVoice, type VoiceCommand } from '../lib/voice';

const LANG_KEY = 'viq:voice-lang';
const HOLD_KEY = 'viq:voice-hold';
/** Seconds between a touch and starting to say it. */
const SPEECH_LAG = 1;
const LANGS = [{ code: 'de-DE', label: 'DE' }, { code: 'en-US', label: 'EN' }];
const POINT: Partial<Record<ActionCode, ActionCode>> = { attack: 'kill', serve: 'ace', block_touch: 'block_point' };

/**
 * Voice tagging: say who did what ("7 pass 2, 1 set, 5 kill", "our point", "their point", "undo"),
 * with or without video. Each phrase is turned into tags as soon as it is complete.
 */
export function VoiceBar({ players, player, onTag, onWon, onLost, onUndo, onClose, panelHidden, onTogglePanel, score }: {
  players: Player[];
  /** The video (when tagging along one): tags get the time the phrase started, and it can pause while you speak. */
  player?: React.RefObject<PlayerHandle | null>;
  onTag: (e: Partial<VEvent>) => void; onWon: () => void; onLost: () => void; onUndo: () => void; onClose: () => void;
  /** Landscape: the tagging panel is hidden so the video is bigger. */
  panelHidden?: boolean; onTogglePanel?: () => void;
  /** Shown in the strip (the header is hidden for a bigger video in landscape). */
  score?: string;
}) {
  const [hold, setHold] = useState(() => { try { return localStorage.getItem(HOLD_KEY) === '1'; } catch { return false; } });
  const holdRef = useRef(hold);
  holdRef.current = hold;
  // When the phrase started (video time), and whether the video was playing then.
  const phrase = useRef<{ t: number | null; playing: boolean } | null>(null);
  const startPhrase = () => {
    if (phrase.current) return;
    const p = player?.current;
    phrase.current = { t: p?.time() ?? null, playing: !!p?.isPlaying() };
    if (holdRef.current && phrase.current.playing) p?.pause();
  };
  const endPhrase = () => {
    const ph = phrase.current;
    phrase.current = null;
    // Carry on: paused for the phrase on purpose, or stopped by the phone's speech recognizer.
    if (ph?.playing && !player?.current?.isPlaying()) player?.current?.play();
    return ph;
  };
  // Standard German or English (an earlier "de-CH" choice becomes standard German).
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved) return saved.startsWith('de') ? 'de-DE' : 'en-US';
      return navigator.language.startsWith('de') ? 'de-DE' : 'en-US';
    } catch { return 'de-DE'; }
  });
  const [state, setState] = useState<{ listening: boolean; error?: string }>({ listening: false });
  const [interim, setInterim] = useState('');
  const [log, setLog] = useState<{ text: string; done: string[] }[]>([]);
  const listener = useRef<Listener | null>(null);
  const handlers = useRef({ onTag, onWon, onLost, onUndo, players });
  handlers.current = { onTag, onWon, onLost, onUndo, players };

  function apply(text: string, at: number | null) {
    const { onTag, onWon, onLost, onUndo, players } = handlers.current;
    // Along a video: the first touch about a second before the phrase started, the next ones 0.8 s apart.
    let k = 0;
    const timeOf = () => (at == null ? undefined : Math.max(0, at - SPEECH_LAG + 0.8 * k++));
    const cmds = parseVoice(text);
    const done: string[] = [];
    // Tags of this phrase are held until its end, so "5 attack, our point" makes the attack a kill.
    let held: Extract<VoiceCommand, { kind: 'tag' }> | null = null;
    const flush = () => {
      if (!held) return;
      const p = held.jersey != null ? players.find((x) => x.active && x.number === held!.jersey) : undefined;
      const t = timeOf();
      onTag({ action: held.action, value: held.value, ...(t !== undefined ? { t } : {}), ...(p ? { player_id: p.id } : held.jersey != null ? { jersey: held.jersey } : {}) });
      done.push(`${held.jersey != null ? `#${held.jersey} ` : ''}${actionLabel({ action: held.action, value: held.value })}`);
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
      listener.current = await listen(code, (text, final) => {
        if (!final) { startPhrase(); setInterim(text); return; }
        if (!phrase.current) startPhrase();
        const ph = endPhrase();
        setInterim('');
        apply(text, ph?.t ?? null);
      }, setState);
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

  const [open, setOpen] = useState(false);
  if (!canListen()) return <div className="voice-bar"><span className="small error">This browser cannot listen: use Chrome, Edge or Safari, or the Android app.</span><button className="btn-ghost small" onClick={onClose}>Close</button></div>;
  const lastLine = log[0];
  return (
    <div className={`voice-bar ${open ? 'open' : ''}`} aria-live="polite">
      <div className="voice-head">
        <span className={`voice-dot ${state.listening ? 'on' : ''}`} aria-label={state.listening ? 'Listening' : 'Not listening'} />
        {score && <b className="voice-score">{score}</b>}
        <span className="voice-now">
          {interim ? <span className="voice-interim">{interim}</span>
            : lastLine ? <span className="small">«{lastLine.text}» {lastLine.done.length ? <b>→ {lastLine.done.join(', ')}</b> : <span className="error">not understood</span>}</span>
            : <span className="muted small">{lang.startsWith('de') ? '«7 Annahme 2, 1 Zuspiel, 5 Punkt» · «Sieben nimmt gut an» · «Punkt Gegner» · «zurück»' : '"7 pass 2, 1 set, 5 kill" · "their point" · "undo"'}</span>}
        </span>
        {!state.listening && <button className="btn small" onClick={() => start()}>Start</button>}
        {onTogglePanel && <button className="btn-ghost small voice-panel-btn" onClick={onTogglePanel}>{panelHidden ? 'Panel' : 'Bigger video'}</button>}
        <button className="btn-ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Less' : 'More'}</button>
        <button className="btn-ghost small" onClick={() => { listener.current?.stop(); onClose(); }}>Stop</button>
      </div>
      {state.error && <span className="small error">{state.error}</span>}
      {open && (
        <div className="voice-more">
          <div className="row wrap">
            <span className="lang-switch">{LANGS.map((l) => <button key={l.code} className={lang === l.code ? 'on' : ''} onClick={() => switchLang(l.code)}>{l.label}</button>)}</span>
            {player && (
              <label className="toggle small"><input type="checkbox" checked={hold} onChange={(e) => { setHold(e.target.checked); try { localStorage.setItem(HOLD_KEY, e.target.checked ? '1' : '0'); } catch { /* storage unavailable */ } }} /> Pause the video while I speak</label>
            )}
          </div>
          {log.map((l, i) => (
            <div key={i} className={`voice-line small ${i ? 'muted' : ''}`}>
              <span>«{l.text}»</span> {l.done.length ? <b>→ {l.done.join(', ')}</b> : <span className="error">not understood</span>}
            </div>
          ))}
          <span className="small muted">Along a video, each tag gets the time you started speaking (minus a second). Headphones keep the video's commentary out of the microphone.</span>
        </div>
      )}
    </div>
  );
}
