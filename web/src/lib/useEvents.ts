import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type VEvent } from './api';

/**
 * Event list with optimistic writes and an offline outbox, so courtside
 * tagging keeps working when the gym Wi-Fi drops. Pending events live in
 * localStorage until the server acknowledges them (POST is idempotent per client_id).
 */
type Pending = Partial<VEvent> & { client_id: string };

const key = (matchId: number) => `viq:outbox:${matchId}`;

/** Edits and deletes of saved events made without a connection, sent when it is back. */
type Edit = { id: number; patch?: Partial<VEvent>; del?: true };
const editsKey = (matchId: number) => `viq:edits:${matchId}`;
function loadEdits(matchId: number): Edit[] {
  try { return JSON.parse(localStorage.getItem(editsKey(matchId)) ?? '[]'); } catch { return []; }
}
function saveEdits(matchId: number, items: Edit[]) {
  try { localStorage.setItem(editsKey(matchId), JSON.stringify(items)); } catch { /* storage full or blocked */ }
}
function queueEdit(matchId: number, edit: Edit) {
  const list = loadEdits(matchId);
  const cur = list.find((x) => x.id === edit.id);
  if (!cur) list.push(edit);
  else if (edit.del) { delete cur.patch; cur.del = true; }
  else if (!cur.del) cur.patch = { ...cur.patch, ...edit.patch };
  saveEdits(matchId, list);
}
/** The server's list with the edits still waiting applied on top (so a reload does not undo them). */
function withEdits(matchId: number, list: VEvent[]): VEvent[] {
  const edits = new Map(loadEdits(matchId).map((x) => [x.id, x]));
  return list.filter((e) => !edits.get(e.id)?.del).map((e) => (edits.get(e.id)?.patch ? { ...e, ...edits.get(e.id)!.patch } : e));
}
const offline = (err: unknown) => err instanceof ApiError && err.status === 0;

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
    return sortEvents([...withEdits(matchId, initial), ...pending]);
  });
  const countPending = () => loadOutbox(matchId).length + loadEdits(matchId).length;
  const [pendingCount, setPendingCount] = useState(countPending);
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
      for (const edit of loadEdits(matchId)) {
        try {
          if (edit.del) await api.deleteEvent(edit.id);
          else await api.updateEvent(edit.id, edit.patch!);
        } catch (err) {
          if (offline(err)) throw err; // still offline: keep the rest queued
          // Refused (e.g. the event is gone): nothing left to apply.
        }
        saveEdits(matchId, loadEdits(matchId).filter((x) => x.id !== edit.id));
      }
    } catch {
      // stay queued; retried on the next interval / reconnect
    } finally {
      flushing.current = false;
      setPendingCount(countPending());
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
    try {
      const saved = await api.updateEvent(ev.id, patch);
      setEvents((list) => list.map((e) => (e.id === saved.id ? saved : e)));
    } catch (err) {
      if (!offline(err)) throw err;
      queueEdit(matchId, { id: ev.id, patch });
      setPendingCount(countPending());
    }
  }, [matchId]);

  const remove = useCallback(async (ev: VEvent) => {
    setEvents((list) => list.filter((e) => e.id !== ev.id));
    if (ev.id < 0) {
      saveOutbox(matchId, loadOutbox(matchId).filter((p) => p.client_id !== ev.client_id));
      setPendingCount(countPending());
      return;
    }
    try {
      await api.deleteEvent(ev.id);
    } catch (err) {
      if (!offline(err)) throw err;
      queueEdit(matchId, { id: ev.id, del: true });
      setPendingCount(countPending());
    }
  }, [matchId]);

  const replaceAll = useCallback((list: VEvent[]) => {
    const pending = loadOutbox(matchId).map((p) => ({ ...p, id: tempId-- }) as VEvent);
    setEvents(sortEvents([...withEdits(matchId, list), ...pending]));
  }, [matchId]);

  return { events, add, update, remove, replaceAll, pendingCount };
}
