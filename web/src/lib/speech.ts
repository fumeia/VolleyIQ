import { isApp } from './api';
import { Native } from './native';
import { voiceHints } from './voice';

/**
 * Listening for voice tags, one phrase at a time: in the Android app with the phone's speech
 * recognizer (offline when the phone has the language), in a browser with its own (Chrome, Edge,
 * Safari). Calls [onText] with what was heard so far (final = the phrase is complete).
 */
export interface Listener { stop(): void }

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

function browserRecognition(): (new () => Rec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => isApp() || !!browserRecognition();

export async function listen(lang: string, onText: (text: string, final: boolean) => void, onState: (s: { listening: boolean; error?: string }) => void): Promise<Listener> {
  if (isApp()) {
    const subs = await Promise.all([
      Native.addListener('speech', (r) => onText(r.text, r.final)),
      Native.addListener('speechState', onState),
    ]);
    // The words we expect, so the recognizer prefers "pass" over "past" (Android 13+).
    await Native.startListening({ lang, hints: voiceHints(lang) });
    onState({ listening: true });
    return { stop: () => { void Native.stopListening(); subs.forEach((s) => s.remove()); onState({ listening: false }); } };
  }
  const R = browserRecognition();
  if (!R) throw new Error('This browser cannot listen: use Chrome, Edge or Safari, or the Android app');
  let on = true;
  const rec = new R();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) onText(e.results[i][0].transcript, e.results[i].isFinal);
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { on = false; onState({ listening: false, error: 'The microphone is not allowed' }); }
    else if (e.error !== 'no-speech' && e.error !== 'aborted') onState({ listening: true, error: `Speech recognition: ${e.error}` });
  };
  // Browsers stop after a while of silence: start again until switched off.
  rec.onend = () => { if (on) { try { rec.start(); } catch { /* already running */ } } };
  rec.start();
  onState({ listening: true });
  return { stop: () => { on = false; rec.abort(); onState({ listening: false }); } };
}
