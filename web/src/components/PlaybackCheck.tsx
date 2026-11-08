import { useEffect, useRef, useState } from 'react';
import { Native, type VideoInfo } from '../lib/native';

// MediaCodecInfo.CodecProfileLevel values for H.264.
const AVC: Record<number, string> = { 1: 'Baseline', 2: 'Main', 4: 'Extended', 8: 'High', 16: 'High 10', 32: 'High 4:2:2', 64: 'High 4:4:4', 65536: 'Constrained Baseline', 524288: 'Constrained High' };

/**
 * Numbers to find out why a phone video plays badly: the file's format and the phone's decoder
 * for it, the app's web engine, and frames shown and dropped while the video plays.
 */
export function PlaybackCheck({ uri }: { uri: string }) {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<{ fps: number; dropped: number; total: number; droppedAll: number; rate: number; playing: boolean } | null>(null);
  const last = useRef<{ at: number; total: number; dropped: number } | null>(null);
  useEffect(() => { Native.videoInfo({ uri }).then(setInfo).catch((e) => setErr((e as Error).message)); }, [uri]);
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = document.querySelector<HTMLVideoElement>('.ws-video video');
      if (!v?.getVideoPlaybackQuality) return;
      const q = v.getVideoPlaybackQuality();
      const now = performance.now();
      const l = last.current;
      if (l && now > l.at) {
        const s = (now - l.at) / 1000;
        setLive({ fps: (q.totalVideoFrames - l.total - (q.droppedVideoFrames - l.dropped)) / s, dropped: (q.droppedVideoFrames - l.dropped) / s, total: q.totalVideoFrames, droppedAll: q.droppedVideoFrames, rate: v.playbackRate, playing: !v.paused });
      }
      last.current = { at: now, total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
    }, 1000);
    return () => clearInterval(t);
  }, []);
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
          <div><b>Hardware decoders</b> {hw.length ? hw.map((d) => `${d.name}${d.profileOk ? '' : ' (not this profile)'}`).join(', ') : 'none'}</div>
        </>
      )}
      <div><b>While playing</b> {live ? `${live.playing ? 'playing' : 'paused'} at ${live.rate}×: ${live.fps.toFixed(1)} frames/s shown, ${live.dropped.toFixed(1)}/s dropped · total ${live.total} shown, ${live.droppedAll} dropped` : 'start the video'}</div>
    </div>
  );
}
