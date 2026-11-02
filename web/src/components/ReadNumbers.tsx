import { useState } from 'react';
import { api, type Player } from '../lib/api';
import { GRAB_NOTE, grabPictures, grabWay } from '../lib/grab';
import type { PlayerHandle } from './VideoPlayer';

/** Zoomed in: the part in view as one picture; otherwise four quarters. */
const g0 = (view: unknown) => (view ? 'view' as const : 'quarters' as const);

type Found = { shirt: string; side: string | null; numbers: { number: number; libero: boolean }[] };

/**
 * Fills a roster from the video: frames where the shirt numbers can be seen (the line-up
 * before the game, a time-out, players on court) go to the AI, which lists the numbers per
 * shirt colour. Pick the team's colour: the numbers not yet on the roster are added as players
 * named after their number (roles and names can be set on the team page).
 */
export function ReadNumbers({ player, teamId, teamName, players, onAdded }: {
  player: React.RefObject<PlayerHandle | null>; teamId: number | null; teamName: string; players: Player[]; onAdded: () => void;
}) {
  // Each added frame: its time, whether it was zoomed in, and its pictures (one, or four quarters).
  const [frames, setFrames] = useState<{ t: number; zoomed: boolean; data: string[] }[]>([]);
  const MAX = 12;
  const used = frames.reduce((a, f) => a + f.data.length, 0);
  const [found, setFound] = useState<Found[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const way = grabWay(player.current);
  const have = new Set(players.filter((p) => p.active).map((p) => p.number));
  const run = async (label: string, f: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await f(); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(''); }
  };
  if (!teamId) return <p className="small muted">Pick a team for this match first.</p>;
  if (!way) return <p className="small muted">Load the match video first.</p>;
  const time = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return (
    <div className="read-numbers">
      <p className="small muted">
        Pause where the shirt numbers can be seen (the line-up before the game, a time-out, players on court). Zoom in on the players
        (two fingers on the video, or Ctrl + mouse wheel) and add the frame: the zoomed part is sent at full resolution. Unzoomed, the frame
        is sent as four quarters. Several frames from different moments read more numbers.
        {GRAB_NOTE[way] && ` ${GRAB_NOTE[way]}`}
      </p>
      <div className="row wrap">
        <button className="btn" disabled={!!busy || used + (player.current?.view() ? 1 : 4) > MAX} onClick={() => run('frame', async () => {
          const g = await grabPictures(player.current!, [g0(player.current!.view())]);
          setFrames((l) => [...l, { t: g.t, zoomed: g.zoomed, data: g.data[0] }]);
          setFound(null);
        })}>{busy === 'frame' ? 'Taking the frame…' : 'Add this frame'}</button>
        <span className="small muted">{used}/{MAX} pictures</span>
        {frames.map((f, i) => (
          <span key={i} className="chip">{time(f.t)}{f.zoomed ? ' zoomed' : ' whole'} <button className="link" onClick={() => { setFrames((l) => l.filter((_, k) => k !== i)); setFound(null); }} aria-label="Remove">✕</button></span>
        ))}
      </div>
      {frames.length > 0 && !found && (
        <button className="btn btn-primary" disabled={!!busy} onClick={() => run('read', async () => {
          const r = await api.readNumbers(frames.flatMap((f) => f.data.map((data) => ({ media_type: 'image/jpeg', data }))));
          setFound(r.teams);
          setOff(new Set());
          if (!r.teams.length) setError('No shirt numbers could be read. Try frames where the players are closer or face the camera.');
        })}>{busy === 'read' ? 'Reading the numbers…' : 'Read the shirt numbers'}</button>
      )}
      {found?.map((t, i) => {
        const fresh = t.numbers.filter((n) => !have.has(n.number) && !off.has(`${i}:${n.number}`));
        return (
          <div key={i} className="card numbers-team">
            <b>{t.shirt}{t.side ? <small className="muted"> · {t.side}</small> : null}</b>
            <div className="chips">
              {t.numbers.map((n) => {
                const k = `${i}:${n.number}`;
                const known = have.has(n.number);
                return (
                  <button key={k} className={`chip ${known ? '' : off.has(k) ? '' : 'on'}`} disabled={known} title={known ? 'Already on the roster' : 'Tap to leave out'}
                    onClick={() => setOff((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x; })}>
                    {n.number}{n.libero ? ' L' : ''}{known ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
            <button className="btn" disabled={!!busy || !fresh.length} onClick={() => run('add', async () => {
              for (const n of fresh) await api.addPlayer(teamId, { name: `#${n.number}`, number: n.number, role: n.libero ? 'L' : 'OH' });
              onAdded();
              setFound(null);
              setFrames([]);
            })}>{fresh.length ? `Add ${fresh.length} to ${teamName}` : 'All already on the roster'}</button>
          </div>
        );
      })}
      {found && found.length > 0 && <p className="small muted">Pick the colour of {teamName}. Added players are named after their number; set roles (and names, if you know them) on the team page. Liberos come in as L, everyone else as outside hitter until you change it.</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
