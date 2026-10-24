import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type VEvent } from './api';

/**
 * Event list with optimistic writes and an offline outbox, so courtside
 * tagging keeps working when the gym Wi-Fi drops. Pending events live in
 * localStorage until the server acknowledges them (POST is idempotent per client_id).
 */
type Pending = Partial<VEvent> & { client_id: string };

const key = (matchId: number) => `viq:outbox:${matchId}`;

function loadOutbox(matchId: number): Pending[] {
  try { return JSON.parse(localStorage.getItem(key(matchId)) ?? '[]'); } catch { return []; }
}
function saveOutbox(matchId: number, items: Pending[]) {
  try { localStorage.setItem(key(matchId), JSON.stringify(items)); } catch { /* storage full or blocked */ }
}

let tempId = -1;
const sortEvents = (list: VEvent[]) =>
  [...list].sort((a, b) => (a.t ?? 1e12) - (b.t ?? 1e12) || Math.abs(a.id) - Math.abs(b.id));

export function useEvents(matchId: number, initial: VEvent[]) {
  const [events, setEvents] = useState<VEvent[]>(() => {
    const pending = loadOutbox(matchId).map((p) => ({ ...p, id: tempId-- }) as VEvent);
    return sortEvents([...initial, ...pending]);
  });
  const [pendingCount, setPendingCount] = useState(() => loadOutbox(matchId).length);
  const flushing = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const item of loadOutbox(matchId)) {
        const saved = await api.addEvent(matchId, item);
        const current = loadOutbox(matchId).find((p) => p.client_id === item.client_id);
        if (!current) { await api.deleteEvent(saved.id); continue; } // undone while in flight
        saveOutbox(matchId, loadOutbox(matchId).filter((p) => p.client_id !== item.client_id));
        setEvents((list) => sortEvents(list.map((e) => (e.client_id === item.client_id ? saved : e))));
      }
    } catch {
      // stay queued; retried on the next interval / reconnect
    } finally {
      flushing.current = false;
      setPendingCount(loadOutbox(matchId).length);
    }
  }, [matchId]);

  useEffect(() => {
    flush();
    const timer = setInterval(flush, 10000);
    window.addEventListener('online', flush);
    return () => { clearInterval(timer); window.removeEventListener('online', flush); };
  }, [flush]);

  const add = useCallback((data: Partial<VEvent>) => {
    const client_id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const item: Pending = { ...data, client_id, status: 'confirmed', source: 'manual' };
    saveOutbox(matchId, [...loadOutbox(matchId), item]);
    setEvents((list) => sortEvents([...list, { ...item, id: tempId--, match_id: matchId } as VEvent]));
    setPendingCount((n) => n + 1);
    flush();
    return client_id;
  }, [matchId, flush]);

  const update = useCallback(async (ev: VEvent, patch: Partial<VEvent>) => {
    setEvents((list) => sortEvents(list.map((e) => (e === ev || e.id === ev.id ? { ...e, ...patch } : e))));
    if (ev.id < 0) {
      saveOutbox(matchId, loadOutbox(matchId).map((p) => (p.client_id === ev.client_id ? { ...p, ...patch, client_id: p.client_id } : p)));
      return;
    }
    const saved = await api.updateEvent(ev.id, patch);
    setEvents((list) => list.map((e) => (e.id === saved.id ? saved : e)));
  }, [matchId]);

  const remove = useCallback(async (ev: VEvent) => {
    setEvents((list) => list.filter((e) => e.id !== ev.id));
    if (ev.id < 0) {
      saveOutbox(matchId, loadOutbox(matchId).filter((p) => p.client_id !== ev.client_id));
      setPendingCount(loadOutbox(matchId).length);
      return;
    }
    await api.deleteEvent(ev.id);
  }, [matchId]);

  const replaceAll = useCallback((list: VEvent[]) => {
    const pending = loadOutbox(matchId).map((p) => ({ ...p, id: tempId-- }) as VEvent);
    setEvents(sortEvents([...list, ...pending]));
  }, [matchId]);

  return { events, add, update, remove, replaceAll, pendingCount };
}
