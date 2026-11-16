import { useEffect, useRef, useState } from 'react';
import { actionLabel, type ActionCode } from '../lib/actions';
import { fmtTime } from './TagPad';
import type { Player, VEvent } from '../lib/api';
import type { PlayerHandle } from './VideoPlayer';
import { canListen, listen, type Listener } from '../lib/speech';
import { parseVoice, SET_CALL_LABEL, SET_SPOTS, unknownWords, voiceSpots, type VoiceCommand } from '../lib/voice';
import { ATTACK_CODES } from '../lib/actions';

const LANG_KEY = 'viq:voice-lang';
const HOLD_KEY = 'viq:voice-hold';
const UNKNOWN_KEY = 'viq:voice-unknown';

/** Words the voice tagging did not know, with how often they came (kept on this device). */
function readUnknown(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(UNKNOWN_KEY) ?? '{}'); } catch { return {}; }
}
/** Seconds between a touch and starting to say it. */
const SPEECH_LAG = 1;
const LANGS = [{ code: 'de-DE', label: 'DE' }, { code: 'en-US', label: 'EN' }];
const POINT: Partial<Record<ActionCode, ActionCode>> = { attack: 'kill', serve: 'ace', block_touch: 'block_point' };

/**
 * Voice tagging: say who did what ("7 pass 2, 1 set, 5 kill", "our point", "their point", "undo"),
 * with or without video. Each phrase is turned into tags as soon as it is complete.
 */
export function VoiceBar({ players, player, onTag, onWon, onLost, onUndo, onClose, panelHidden, onTogglePanel, score, session = [], onEdit }: {
  players: Player[];
  /** The video (when tagging along one): tags get the time the phrase started, and it can pause while you speak. */
  player?: React.RefObject<PlayerHandle | null>;
  onTag: (e: Partial<VEvent>) => void; onWon: () => void; onLost: () => void; onUndo: () => void; onClose: () => void;
  /** The tags said by voice while this bar was open (newest last), and how to open one for editing. */
  session?: VEvent[]; onEdit?: (e: VEvent) => void;
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

  const [unknown, setUnknown] = useState<Record<string, number>>(readUnknown);
  function noteUnknown(text: string) {
    const ws = unknownWords(text);
    if (!ws.length) return;
    setUnknown((u) => {
      const next = { ...u };
      for (const w of ws) next[w] = (next[w] ?? 0) + 1;
      try { localStorage.setItem(UNKNOWN_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }

  function apply(text: string, at: number | null) {
    noteUnknown(text);
    const { onTag, onWon, onLost, onUndo, players } = handlers.current;
    // Along a video: the first touch about a second before the phrase started, the next ones 0.8 s apart.
    let k = 0;
    const timeOf = () => (at == null ? undefined : Math.max(0, at - SPEECH_LAG + 0.8 * k++));
    const cmds = parseVoice(text);
    const done: string[] = [];
    // Tags of this phrase are held until its end, so "5 attack, our point" makes the attack a kill.
    let held: Extract<VoiceCommand, { kind: 'tag' }> | null = null;
    // A called set ("9 set outside") goes to that spot from the usual setter's spot, and the next
    // attack of the same phrase was hit from there.
    let setTo: { x: number; y: number } | null = null;
    const flush = () => {
      if (!held) return;
      const p = held.jersey != null ? players.find((x) => x.active && x.number === held!.jersey) : undefined;
      const t = timeOf();
      const isSet = held.action === 'set' || held.action === 'assist';
      const spot = held.to && isSet ? SET_SPOTS[held.to] : null;
      const hitFrom = !held.to && setTo && ATTACK_CODES.includes(held.action) ? setTo : null;
      const spots = voiceSpots(held, hitFrom);
      onTag({ action: held.action, value: held.value, ...(t !== undefined ? { t } : {}), ...(p ? { player_id: p.id } : held.jersey != null ? { jersey: held.jersey } : {}), ...spots });
      if (spot) setTo = spot; else if (hitFrom) setTo = null;
      done.push(`${held.jersey != null ? `#${held.jersey} ` : ''}${actionLabel({ action: held.action, value: held.value })}${held.to ? ` ${SET_CALL_LABEL[held.to]}` : ''}${held.zone ? ` zone ${held.zone}` : ''}${held.depth ? ` ${held.depth}` : ''}${held.dir ? ` ${held.dir}` : ''}`);
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
  const [listOpen, setListOpen] = useState(false);
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
        {onEdit && session.length > 0 && <button className="btn-ghost small" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen}>Tags {session.length}</button>}
        <button className="btn-ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Less' : 'More'}</button>
        <button className="btn-ghost small" onClick={() => { listener.current?.stop(); onClose(); }}>Stop</button>
      </div>
      {state.error && <span className="small error">{state.error}</span>}
      {listOpen && onEdit && (
        <ol className="voice-tags small" reversed>
          {[...session].reverse().map((e) => {
            const p = players.find((x) => x.id === e.player_id);
            const where = [e.zone ? `zone ${e.zone}` : null, e.x != null ? 'spot' : null].filter(Boolean).join(', ');
            return (
              <li key={e.client_id ?? e.id}>
                <button className="voice-tag" onClick={() => onEdit(e)}>
                  <span className="muted tnum">{e.t != null ? fmtTime(e.t) : ''}</span>
                  <b>{p ? `#${p.number} ` : e.jersey != null ? `#${e.jersey} ` : ''}{actionLabel(e)}</b>
                  {where && <span className="muted">{where}</span>}
                  <span className="voice-tag-edit">Edit</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
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
          {Object.keys(unknown).length > 0 && (() => {
            const list = Object.entries(unknown).sort((a, b) => b[1] - a[1]).slice(0, 30);
            const text = list.map(([w, n]) => `${w} (${n})`).join(', ');
            return (
              <div className="voice-line small">
                <span>Words not understood: {text}</span>{' '}
                <button className="btn-ghost small" onClick={() => { void navigator.clipboard?.writeText(text).catch(() => {}); }}>Copy</button>
                <button className="btn-ghost small" onClick={() => { setUnknown({}); try { localStorage.removeItem(UNKNOWN_KEY); } catch { /* storage unavailable */ } }}>Clear</button>
              </div>
            );
          })()}
          <span className="small muted">Along a video, each tag gets the time you started speaking (minus a second). Headphones keep the video's commentary out of the microphone.</span>
        </div>
      )}
    </div>
  );
}
