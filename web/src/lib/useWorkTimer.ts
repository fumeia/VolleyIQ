import { useEffect } from 'react';
import { api } from './api';

const IDLE_AFTER = 90; // s without a tap, key or playing video: the analyst stepped away
const FLUSH_EVERY = 60; // s

/**
 * Counts the time someone actively works on a match (page visible and a tap, key
 * or playing video in the last 90 s) and adds it to the match on the server, so
 * the analysis time per match can be measured. Unsent seconds wait in local
 * storage when offline.
 */
export function useWorkTimer(matchId: number) {
  useEffect(() => {
    const key = `viq:work:${matchId}`;
    const read = () => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } };
    const write = (v: number) => { try { localStorage.setItem(key, String(v)); } catch { /* private mode */ } };
    let pending = read();
    let lastInput = Date.now();
    let sinceFlush = 0;
    let sending = false;
    const touch = () => { lastInput = Date.now(); };
    const playing = () => [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended);
    async function flush() {
      if (sending || pending < 1) return;
      sending = true;
      const sec = Math.min(600, Math.round(pending));
      try {
        await api.addWork(matchId, sec);
        pending -= sec;
        write(pending);
      } catch { /* offline: try again later */ }
      sending = false;
    }
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!playing() && Date.now() - lastInput > IDLE_AFTER * 1000) return;
      pending += 5;
      sinceFlush += 5;
      write(pending);
      if (sinceFlush >= FLUSH_EVERY) { sinceFlush = 0; void flush(); }
    }, 5000);
    const hidden = () => { if (document.visibilityState === 'hidden') void flush(); };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('online', flush);
    void flush();
    return () => {
      window.clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('online', flush);
      void flush();
    };
  }, [matchId]);
}
