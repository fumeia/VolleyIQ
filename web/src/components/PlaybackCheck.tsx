import { useEffect, useRef, useState } from 'react';
import { Native, type VideoInfo } from '../lib/native';

// MediaCodecInfo.CodecProfileLevel values for H.264.
const AVC: Record<number, string> = { 1: 'Baseline', 2: 'Main', 4: 'Extended', 8: 'High', 16: 'High 10', 32: 'High 4:2:2', 64: 'High 4:4:4', 65536: 'Constrained Baseline', 524288: 'Constrained High' };

export interface Live { fps: number; dropped: number; total: number; droppedAll: number; rate: number; playing: boolean; paint: number }

/** Frames shown and dropped per second by the match video, and how often the page is drawn. */
export function useLiveStats(): Live | null {
  const [live, setLive] = useState<Live | null>(null);
  const last = useRef<{ at: number; total: number; dropped: number } | null>(null);
  const paints = useRef(0);
  useEffect(() => {
    let run = true;
    const raf = () => { paints.current++; if (run) requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    const t = window.setInterval(() => {
      const v = document.querySelector<HTMLVideoElement>('.ws-video video');
      const now = performance.now();
      const p = paints.current;
      paints.current = 0;
      if (!v?.getVideoPlaybackQuality) return;
      const q = v.getVideoPlaybackQuality();
      const l = last.current;
      if (l && now > l.at) {
        const s = (now - l.at) / 1000;
        setLive({ fps: (q.totalVideoFrames - l.total - (q.droppedVideoFrames - l.dropped)) / s, dropped: (q.droppedVideoFrames - l.dropped) / s, total: q.totalVideoFrames, droppedAll: q.droppedVideoFrames, rate: v.playbackRate, playing: !v.paused, paint: p / s });
      }
      last.current = { at: now, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
    }, 1000);
    return () => { run = false; clearInterval(t); };
  }, []);
  return live;
}

export const liveText = (live: Live | null) => live
  ? `${live.playing ? 'playing' : 'paused'} at ${live.rate}×: ${live.fps.toFixed(1)} frames/s shown, ${live.dropped.toFixed(1)}/s dropped · page drawn ${live.paint.toFixed(0)} times/s · total ${live.total} shown, ${live.droppedAll} dropped`
  : 'start the video';

/**
 * Numbers to find out why a phone video plays badly: the file's format and the phone's decoder
 * for it, the app's web engine, and frames shown and dropped while the video plays.
 */
export function PlaybackCheck({ uri, onPlain }: { uri: string; onPlain: () => void }) {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { Native.videoInfo({ uri }).then(setInfo).catch((e) => setErr((e as Error).message)); }, [uri]);
  const live = useLiveStats();
  const engine = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? navigator.userAgent;
  const profile = info?.profile != null ? (AVC[info.profile] ?? `profile ${info.profile}`) : 'not stated';
  const hw = info?.decoders?.filter((d) => d.hardware) ?? [];
  return (
    <div className="playback-check small">
      <div><b>Web engine</b> Chrome {engine}</div>
      {err && <div>File: could not be read ({err})</div>}
      {info && (
        <>
          <div><b>File</b> {info.mime} · {info.width}×{info.height} · {info.fps ? `${Math.round(info.fps * 100) / 100} fps` : 'fps not stated'} · {profile}{info.level ? ` level ${info.level}` : ''}{info.bitrate ? ` · ${(info.bitrate / 1e6).toFixed(1)} Mbit/s` : ''}{info.colorTransfer != null ? ` · transfer ${info.colorTransfer}` : ''}</div>
          <div><b>Decoder for it</b> {info.decoder ? `${info.decoder} (${info.hardware === false ? 'software' : info.hardware ? 'hardware' : 'unknown'})` : 'none found for this exact format'}</div>
          {info.profile === 16 && <div><b>Note</b> 10-bit video: no hardware decoder on this phone plays it smoothly. An 8-bit copy (yuv420p) plays smoothly.</div>}
          <div><b>Hardware decoders</b> {hw.length ? hw.map((d) => `${d.name}${d.profileOk ? '' : ' (not this profile)'}`).join(', ') : 'none'}</div>
        </>
      )}
      <div><b>While playing</b> {liveText(live)}</div>
      <button className="btn small" onClick={onPlain}>Try the video on a plain page</button>
    </div>
  );
}

/** Only the video on the whole screen (nothing else drawn), with the same numbers. */
export function PlainVideoTest({ onClose }: { onClose: () => void }) {
  const live = useLiveStats();
  useEffect(() => {
    document.body.classList.add('video-plain');
    return () => document.body.classList.remove('video-plain');
  }, []);
  const v = () => document.querySelector<HTMLVideoElement>('.ws-video video');
  return (
    <div className="plain-test small">
      <div>{liveText(live)}</div>
      <div className="row">
        <button className="btn small" onClick={() => { const x = v(); if (x) { if (x.paused) void x.play(); else x.pause(); } }}>Play / pause</button>
        <button className="btn small" onClick={() => { const x = v(); if (x) x.playbackRate = x.playbackRate === 1 ? 0.25 : 1; }}>1× / 0.25×</button>
        <button className="btn small" onClick={onClose}>Back</button>
      </div>
    </div>
  );
}
