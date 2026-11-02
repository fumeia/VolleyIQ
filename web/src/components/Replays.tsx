import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { ACTION_BY_CODE, SKILLS } from '../lib/actions';
import { api, type Match, type Player, type Playlist, type VEvent } from '../lib/api';
import { ourHalfAt } from '../lib/calibration';
import { EditSheet } from './EditSheet';
import { fmtTime } from './TagPad';
import { VideoPlayer, type PlayerHandle } from './VideoPlayer';
import { FrameStep, SpeedControl } from './SpeedControl';
import { QualityControl } from './QualityControl';
import { Timeline } from './Timeline';
import { available, loadQuality, saveQuality, urlFor, type Quality, type VideoLink } from '../lib/videoQuality';

interface Props {
  token: string;
  matches: Match[];
  players: Player[];
  events: VEvent[];
  /** The match picked elsewhere on the page, if any. */
  initialMatch: number | null;
  /** The team's clip playlists (tags from several matches, in order). */
  playlists?: Playlist[];
}

/** Seconds of video before and after each tagged touch. */
const LEADS = [{ before: 3, after: 2, label: 'Short' }, { before: 6, after: 3, label: 'Long' }];

const sentKey = (token: string) => `viq:sentEdits:${token}`;
const loadSent = (token: string): number[] => { try { return JSON.parse(localStorage.getItem(sentKey(token)) ?? '[]'); } catch { return []; } };

/**
 * Replays on the public link: every tagged touch of a match as a clip, filtered by
 * skill, player and set. The video is the viewer's own copy, played on their device and
 * never uploaded (or the match's YouTube video). With corrections switched on, a viewer
 * who spots a wrong tag can send a correction; it is applied only when it is accepted
 * in the app.
 */
export function Replays({ token, matches, players, events, initialMatch, playlists: shared = [] }: Props) {
  const withTags = matches.filter((m) => events.some((e) => e.match_id === m.id && e.t != null));
  const [matchId, setMatchId] = useState<number | null>(initialMatch ?? withTags[withTags.length - 1]?.id ?? null);
  const match = matches.find((m) => m.id === matchId) ?? null;
  const [files, setFiles] = useState<Record<number, { url: string; name: string }>>({});
  const [skill, setSkill] = useState('all');
  const [result, setResult] = useState<'all' | 'points' | 'errors'>('all');
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [set, setSet] = useState<number | null>(null);
  const [lead, setLead] = useState(0);
  const [rate, setRate] = useState(1);
  const [cur, setCur] = useState<number | null>(null);
  const [playAll, setPlayAll] = useState(false);
  const [editing, setEditing] = useState(false);
  // The correction being made (a tag, or with [add] a touch that is not tagged, at that video time).
  const [target, setTarget] = useState<{ event: VEvent; add?: { matchId: number; t: number } } | null>(null);
  const [notice, setNotice] = useState('');
  const videoBox = useRef<HTMLDivElement>(null);
  const [sent, setSent] = useState<number[]>(() => loadSent(token));
  const player = useRef<PlayerHandle>(null);
  const stopAt = useRef<number | null>(null);

  const video = match?.video;
  const file = matchId != null ? files[matchId] : undefined;
  // A video in the team's storage: a link that expires, fetched when the match is picked.
  // 'failed': the link could not be fetched; the viewer can still choose their own copy.
  const [hosted, setHosted] = useState<Record<number, VideoLink | 'failed'>>({});
  const fetchHosted = (id: number) => api.sharedVideo(token, id).then((r) => setHosted((h) => ({ ...h, [id]: r })))
    .catch(() => setHosted((h) => ({ ...h, [id]: 'failed' })));
  useEffect(() => {
    if (video?.type !== 'hosted' || matchId == null || hosted[matchId]) return;
    fetchHosted(matchId);
  }, [video?.type, matchId]);
  // The link expires after a few hours (a page left open): on a failed load, fetch a fresh one once.
  const renewed = useRef<Set<number>>(new Set());
  function onVideoError() {
    if (file || video?.type !== 'hosted' || matchId == null || renewed.current.has(matchId)) return;
    renewed.current.add(matchId);
    fetchHosted(matchId);
  }
  // 720p by default here (most watch on a phone); the size picked last on this device wins.
  const [quality, setQuality] = useState<Quality>(() => loadQuality('team', '720'));
  const link = video?.type === 'hosted' && matchId != null && hosted[matchId] && hosted[matchId] !== 'failed' ? hosted[matchId] as VideoLink : null;
  const hostedPick = link ? urlFor(link, quality) : null;
  const hostedUrl = hostedPick?.url ?? null;
  const hostedLoading = video?.type === 'hosted' && matchId != null && !hosted[matchId];
  // Your own copy, when chosen, wins over the team video (e.g. when that one does not play).
  const source = file ? { type: 'file' as const, url: file.url }
    : video?.type === 'youtube' ? { type: 'youtube' as const, id: video.id }
    : hostedUrl ? { type: 'file' as const, url: hostedUrl, remote: true, group: `match-${matchId}` }
    : null;

  const all = useMemo(() => events.filter((e) => e.match_id === matchId && e.t != null && ACTION_BY_CODE[e.action]?.group !== 'team')
    .sort((a, b) => a.t! - b.t!), [events, matchId]);
  const sets = [...new Set(all.map((e) => e.set_no ?? 1))].sort((a, b) => a - b);
  const inMatch = players.filter((p) => all.some((e) => e.player_id === p.id)).sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
  // A playlist: its tags in its order, from any match (the video follows the clip's match).
  const [listId, setListId] = useState<number | null>(null);
  // Teammates' own playlists: with their shirt number they see their private ones too, and can make and change their own.
  const [jersey, setJerseyState] = useState<number | null>(() => { try { const v = localStorage.getItem('viq:jersey'); return v && /^\d{1,2}$/.test(v) ? Number(v) : null; } catch { return null; } });
  const setJersey = (n: number | null) => { setJerseyState(n); try { if (n == null) localStorage.removeItem('viq:jersey'); else localStorage.setItem('viq:jersey', String(n)); } catch { /* private mode */ } };
  const [playlists, setPlaylists] = useState<Playlist[]>(shared);
  const reloadLists = () => api.sharedPlaylists(token, jersey).then(setPlaylists).catch(() => {});
  useEffect(() => { reloadLists(); }, [jersey]);
  const putList = (p: Playlist) => setPlaylists((l) => (l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [...l, p]));
  const mineLists = playlists.filter((p) => jersey != null && p.owner_jersey === jersey);
  const [collectId, setCollectId] = useState<number | null>(null);
  const collect = mineLists.find((p) => p.id === collectId) ?? null;
  const list = playlists.find((p) => p.id === listId) ?? null;
  const ownList = !!list && jersey != null && list.owner_jersey === jersey;
  const [plError, setPlError] = useState('');
  const plRun = async (f: () => Promise<unknown>) => { setPlError(''); try { await f(); } catch (e) { setPlError(e instanceof Error ? e.message : t('Failed')); } };
  const listClips = useMemo(() => (list ? list.items.map((id) => events.find((e) => e.id === id)).filter((e): e is VEvent => !!e && e.t != null) : null), [list, events]);
  const clips = listClips ?? all.filter((e) => {
    const def = ACTION_BY_CODE[e.action];
    if (skill !== 'all' && !SKILLS.find((s) => s.label === skill)?.codes.includes(e.action)) return false;
    if (result === 'points' && def?.score !== 'us') return false;
    if (result === 'errors' && def?.score !== 'them') return false;
    if (playerId != null && e.player_id !== playerId) return false;
    if (set != null && (e.set_no ?? 1) !== set) return false;
    return true;
  });
  const idx = clips.findIndex((e) => e.id === cur);
  const current = idx >= 0 ? clips[idx] : null;

  // A clip of another match: switch the match first, then play it once that video is ready.
  const pending = useRef<VEvent | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const e = pending.current;
      const p = player.current;
      if (!e || e.match_id !== matchId || !p?.ready() || p.duration() == null) return;
      pending.current = null;
      play(e);
    }, 300);
    return () => clearInterval(timer);
  });

  function play(e: VEvent) {
    const p = player.current;
    setCur(e.id);
    if (e.match_id !== matchId) { pending.current = e; setMatchId(e.match_id); return; }
    if (!p) return;
    p.seek(Math.max(0, e.t! - LEADS[lead].before));
    p.setRate(rate);
    p.play();
    stopAt.current = e.t! + LEADS[lead].after;
  }

  // Stop at the end of the clip, or go on to the next one when playing all.
  const next = useRef<() => void>(() => {});
  next.current = () => {
    if (playAll && idx >= 0 && idx < clips.length - 1) play(clips[idx + 1]);
    else { player.current?.pause(); setPlayAll(false); }
  };
  useEffect(() => {
    const timer = window.setInterval(() => {
      const t = player.current?.time();
      if (t == null || stopAt.current == null || !player.current?.isPlaying()) return;
      if (t >= stopAt.current) { stopAt.current = null; next.current(); }
    }, 150);
    return () => clearInterval(timer);
  }, []);

  /** Up to the video, play the touch, and open its correction one question at a time. */
  function startEdit(e: VEvent) {
    setPlayAll(false);
    setNotice('');
    videoBox.current?.scrollIntoView({ block: 'start' });
    play(e);
    setTarget({ event: e });
  }
  function startAdd() {
    const t = player.current?.time();
    if (t == null || !match) return;
    player.current?.pause();
    setNotice('');
    videoBox.current?.scrollIntoView({ block: 'start' });
    const at = Math.round(t * 100) / 100;
    setTarget({
      add: { matchId: match.id, t: at },
      event: { id: -1, match_id: match.id, player_id: null, jersey: null, action: 'block_miss', value: null, zone: null, x: null, y: null, fx: null, fy: null, t: at, set_no: null, source: 'manual', status: 'confirmed', confidence: null },
    });
  }
  /** The moment around [t] again (for a touch being added). */
  function playAround(t: number) {
    const p = player.current;
    if (!p) return;
    p.seek(Math.max(0, t - LEADS[lead].before));
    p.setRate(rate);
    p.play();
    stopAt.current = t + 0.5;
  }

  function pickFile(f: File | undefined) {
    if (!f || matchId == null) return;
    setFiles((m) => ({ ...m, [matchId]: { url: URL.createObjectURL(f), name: f.name } }));
  }

  const who = (e: VEvent) => {
    const p = players.find((x) => x.id === e.player_id);
    return p ? `#${p.number ?? '–'} ${p.name.split(' ')[0]}` : e.jersey != null ? `#${e.jersey}` : t('Team');
  };

  if (!withTags.length) return <p className="muted">{t('No tagged touches with video times yet.')}</p>;

  return (
    <div className="replays">
      <div className="row wrap">
        <select className="input" value={matchId ?? ''} onChange={(e) => { setMatchId(Number(e.target.value)); setCur(null); setSet(null); setPlayerId(null); }}>
          {[...withTags].reverse().map((m) => <option key={m.id} value={m.id}>{m.played_on ?? ''} {m.opponent ?? m.label}</option>)}
        </select>
      </div>

      <div className="replay-video" ref={videoBox}>
        {source ? <VideoPlayer key={file ? 'own' : 'team'} ref={player} source={source} onError={onVideoError} /> : hostedLoading ? <div className="replay-pick"><b>{t('Loading the match video…')}</b></div> : (
          <label className="replay-pick">
            <input type="file" accept="video/*" onChange={(e) => pickFile(e.target.files?.[0])} />
            <b>{t('Choose your copy of the match video')}</b>
            <span className="small muted">
              {video?.type === 'hosted' ? `${t('The team video could not be loaded.')} ` : ''}
              {t('It plays here on your device and is not uploaded.')}{video?.type === 'file' ? <> {t('The video file used for tagging is called')} <b>{video.name}</b>.</> : ''}
            </span>
          </label>
        )}
      </div>
      {source && <Timeline player={player} events={all} />}
      {file ? (
        <p className="small muted replay-file">▶ {t('Your copy')}: {file.name} · <label className="link">{t('change')}<input type="file" accept="video/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} /></label>
          {(video?.type === 'hosted' || video?.type === 'youtube') && <> · <button className="link" onClick={() => setFiles((m) => { const n = { ...m }; delete n[matchId!]; return n; })}>{t('back to the team video')}</button></>}</p>
      ) : source && (
        <p className="small muted replay-file">{t('Video not playing?')}{' '}
          {hostedPick && hostedPick.quality !== '480' && available(link).includes('480') && <><button className="link" onClick={() => { setQuality('480'); saveQuality('team', '480'); }}>{t('Try the smaller 480p version')}</button> {t('or')} </>}
          <label className="link">{hostedPick && hostedPick.quality !== '480' && available(link).includes('480') ? t('use your own copy instead') : t('Use your own copy instead')}<input type="file" accept="video/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} /></label></p>
      )}

      <div className="replay-playlists">
        <span className="small muted">{t('Playlists')}</span>
        <div className="chips">
          <button className={`chip ${list ? '' : 'on'}`} onClick={() => { setListId(null); setPlayAll(false); }}>{t('All touches')}</button>
          {playlists.map((p) => (
            <button key={p.id} className={`chip ${listId === p.id ? 'on' : ''}`} onClick={() => { setListId(p.id); setCur(null); setPlayAll(false); }}>
              {p.title} <small>{p.items.length}{p.owner_jersey != null ? ` · #${p.owner_jersey}` : ''}{p.is_public === false ? ` · ${t('private')}` : ''}</small>
            </button>
          ))}
        </div>
        <div className="my-playlists small">
          {jersey == null ? (
            <form className="row wrap" onSubmit={(e) => { e.preventDefault(); const v = Number((e.currentTarget.elements.namedItem('j') as HTMLInputElement).value); if (Number.isInteger(v) && v >= 0 && v <= 99) setJersey(v); }}>
              <span className="muted">{t('Your own playlists: your shirt number')}</span>
              <input name="j" className="input slim jersey-in" inputMode="numeric" maxLength={2} />
              <button className="btn small">OK</button>
            </form>
          ) : (
            <>
              <span className="muted">#{jersey} <button className="link" onClick={() => { setJersey(null); setCollectId(null); }}>{t('change')}</button></span>
              <button className="btn small" onClick={() => plRun(async () => {
                const title = prompt(t('Name of the playlist'))?.trim();
                if (!title) return;
                const isPublic = confirm(t('Show it to the whole team? (Cancel = only for you)'));
                const p = await api.createSharedPlaylist(token, { title, jersey, public: isPublic });
                putList(p); setCollectId(p.id);
              })}>＋ {t('New playlist')}</button>
              {mineLists.length > 0 && !ownList && (
                <label className="row">{t('Add clips to')}
                  <select className="input slim" value={collectId ?? ''} onChange={(e) => setCollectId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">–</option>
                    {mineLists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </label>
              )}
              {ownList && list && (
                <span className="row wrap">
                  <button className="btn small" onClick={() => plRun(async () => putList(await api.updateSharedPlaylist(token, list.id, { jersey, public: !list.is_public })))}>
                    {list.is_public ? t('Public · make private') : t('Private · make public')}
                  </button>
                  <button className="btn-ghost small" onClick={() => plRun(async () => { const title = prompt(t('New name'), list.title)?.trim(); if (title) putList(await api.updateSharedPlaylist(token, list.id, { jersey, title })); })}>{t('Rename')}</button>
                  <button className="btn-ghost small danger" onClick={() => plRun(async () => {
                    if (!confirm(t('Delete the playlist?'))) return;
                    await api.deleteSharedPlaylist(token, list.id, jersey);
                    setPlaylists((l) => l.filter((x) => x.id !== list.id)); setListId(null);
                  })}>{t('Delete')}</button>
                </span>
              )}
            </>
          )}
          {plError && <span className="error">{plError}</span>}
        </div>
      </div>

      {!list && <div className="replay-filters">
        <div className="chips">
          {['all', ...SKILLS.map((s) => s.label)].map((s) => (
            <button key={s} className={`chip ${skill === s ? 'on' : ''}`} onClick={() => setSkill(s)}>{s === 'all' ? t('All') : t(s)}</button>
          ))}
        </div>
        <div className="row wrap">
          <select className="input" value={playerId ?? ''} onChange={(e) => setPlayerId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('All players')}</option>
            {inMatch.map((p) => <option key={p.id} value={p.id}>#{p.number ?? '–'} {p.name}</option>)}
          </select>
          <select className="input" value={set ?? ''} onChange={(e) => setSet(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('All sets')}</option>
            {sets.map((s) => <option key={s} value={s}>{t('Set {n}', { n: s })}</option>)}
          </select>
          <div className="segmented replay-result">
            {(['all', 'points', 'errors'] as const).map((r) => (
              <button key={r} className={result === r ? 'on' : ''} onClick={() => setResult(r)}>{r === 'all' ? t('All') : r === 'points' ? t('Points') : t('Errors')}</button>
            ))}
          </div>
        </div>
      </div>}

      <div className="replay-bar">
        <button className="btn btn-primary" disabled={!source || !clips.length} onClick={() => { setPlayAll(true); play(current ?? clips[0]); }}>▶ {t('Play all {n}', { n: clips.length })}</button>
        <button className="btn" disabled={!source || idx <= 0} onClick={() => play(clips[idx - 1])}>◀</button>
        <button className="btn" disabled={!source || idx >= clips.length - 1} onClick={() => play(clips[idx + 1])}>▶</button>
        <div className="replay-playback">
          <SpeedControl className="btn" rate={rate} youtube={source?.type === 'youtube'} onRate={(r) => { setRate(r); player.current?.setRate(r); }} />
          {source?.type === 'file' && <FrameStep player={player} className="btn" />}
          {!file && hostedPick && <QualityControl className="btn" quality={hostedPick.quality} options={available(link)}
            onPick={(q) => { setQuality(q); saveQuality('team', q); }} />}
        </div>
        <button className="btn-ghost small" onClick={() => setLead((lead + 1) % LEADS.length)}>{t(`${LEADS[lead].label} clips`)}</button>
        <label className="toggle replay-edit-toggle">
          <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} />
          ✎ {t('Suggest corrections')}
        </label>
      </div>

      {editing && source && (
        <button className="btn wide add-touch" onClick={startAdd}>＋ {t('Missing touch? Add one at the current video time')}</button>
      )}
      {notice && <p className="small edit-notice">{notice} <button className="link" onClick={() => setNotice('')}>OK</button></p>}
      {target && match && (
        <EditSheet key={target.add ? `add-${target.add.t}` : target.event.id} token={token} event={target.event} add={target.add}
          players={players.filter((p) => p.active || p.id === target.event.player_id)}
          flip={!!match.calibration && ourHalfAt(match.calibration, target.event.t ?? 0) === 'far'}
          anchor={videoBox.current}
          controls={<>
            <button className="btn small" onClick={() => (target.add ? playAround(target.add.t) : play(target.event))} title="Play it again">↻</button>
            <SpeedControl className="btn small" rate={rate} youtube={source?.type === 'youtube'} onRate={(r) => { setRate(r); player.current?.setRate(r); }} />
          </>}
          onCancel={() => setTarget(null)}
          onSent={() => {
            if (!target.add) { const s = [...sent, target.event.id]; setSent(s); try { localStorage.setItem(sentKey(token), JSON.stringify(s)); } catch { /* private mode */ } }
            setNotice(target.add ? `✓ ${t('Sent: a new touch at {t}.', { t: fmtTime(target.add.t) })}` : `✓ ${t('Sent: your correction.')}`);
            setTarget(null);
          }} />
      )}

      <ol className="replay-list">
        {clips.map((e) => (
          <li key={e.id} className={editing || (collect && !list) || ownList ? 'with-edit' : ''}>
            {collect && !list && jersey != null && (
              <button className="replay-edit" disabled={collect.items.includes(e.id)} title={t('Add to {name}', { name: collect.title })}
                onClick={() => plRun(async () => putList(await api.addSharedItems(token, collect.id, jersey, [e.id])))}>
                {collect.items.includes(e.id) ? '✓' : '＋'}<small>{collect.items.includes(e.id) ? t('in it') : t('add')}</small>
              </button>
            )}
            {ownList && list && jersey != null && (
              <button className="replay-edit" title={t('Remove from the playlist')}
                onClick={() => plRun(async () => putList(await api.removeSharedItem(token, list.id, jersey, e.id)))}>✕<small>{t('remove')}</small></button>
            )}
            {editing && (
              <button className="replay-edit" disabled={!source || sent.includes(e.id)} onClick={() => startEdit(e)} title="Suggest a correction for this touch">
                {sent.includes(e.id) ? '✓' : '✎'}<small>{sent.includes(e.id) ? t('sent') : t('edit')}</small>
              </button>
            )}
            <button className={`replay-clip ${e.id === cur ? 'on' : ''}`} disabled={!source} onClick={() => { setPlayAll(false); play(e); }}>
              <span className="replay-time">{fmtTime(e.t!)}</span>
              <b>{who(e)}</b>
              <span className={`replay-act g-${ACTION_BY_CODE[e.action]?.group}`}>{t(ACTION_BY_CODE[e.action]?.label ?? e.action)}{e.action === 'receive' && e.value != null ? ` ${e.value}` : ''}</span>
              <span className="muted small">{t('Set {n}', { n: e.set_no ?? 1 })}{sent.includes(e.id) ? ` · ✎ ${t('sent')}` : ''}</span>
            </button>
          </li>
        ))}
        {!clips.length && <li className="muted small">{t('No touches match these filters.')}</li>}
      </ol>
    </div>
  );
}
