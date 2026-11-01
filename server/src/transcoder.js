// Makes smaller versions (720p and 480p) of match videos in the bucket, for viewers on a
// weak connection. Runs as its own service (see docker-compose.yml), one video at a time,
// at the lowest CPU priority. It reads the original straight from the bucket and only
// keeps the two new files on disk until they are uploaded.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { presign, s3Config, uploadFile } from './s3.js';

export const QUALITIES = [
  { q: '720', height: 720, crf: 26, maxrate: '2500k', audio: '96k' },
  { q: '480', height: 480, crf: 28, maxrate: '1200k', audio: '64k' },
];

/**
 * Whether [date] falls in the hours "22-7" (from 22:00 to 07:00, Swiss time by default).
 * No hours set: always.
 */
export function inHours(spec, date = new Date(), timeZone = 'Europe/Zurich') {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(spec ?? '');
  if (!m) return true;
  const from = Number(m[1]) % 24, to = Number(m[2]) % 24;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(date));
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** ffmpeg arguments: one decode, both sizes written at once, ready to stream (faststart). [fps]: frame rate cap. */
export function ffmpegArgs(input, outputs, { fps = null } = {}) {
  // Reconnects when the connection to the bucket drops during a long match.
  const net = /^https?:/.test(input) ? ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '30'] : [];
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', ...net, '-i', input];
  for (const o of outputs) {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=-2:${o.height}${fps ? `,fps=${fps}` : ''}`, '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-crf', String(o.crf),
      '-maxrate', o.maxrate, '-bufsize', o.maxrate.replace(/k$/, '') * 2 + 'k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', o.audio, '-movflags', '+faststart', '-y', o.file);
  }
  return args;
}

/** Length (seconds, for the progress) and frame rate of a video (ffprobe). */
function probe(input) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=avg_frame_rate', '-of', 'json', input]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => {
      try {
        const j = JSON.parse(out);
        const [a, b] = String(j.streams?.[0]?.avg_frame_rate ?? '0/1').split('/').map(Number);
        resolve({ duration: Number(j.format?.duration) || null, fps: b ? a / b : null });
      } catch { resolve({ duration: null, fps: null }); }
    });
    p.on('error', () => resolve({ duration: null, fps: null }));
  });
}

const freeBytes = (dir) => { const s = fs.statfsSync(dir); return s.bavail * s.bsize; };

/**
 * Converts the oldest waiting video. [hours] ("22-7"): only then; at the end of the hours
 * ffmpeg is paused (not stopped) and goes on where it was when they come round again.
 */
export async function runOnce(db, cfg, tmpDir, log = console.log, { hours = null, timeZone = 'Europe/Zurich', checkEveryMs = 60_000 } = {}) {
  if (!inHours(hours, new Date(), timeZone)) return false;
  const job = db.prepare("SELECT * FROM video_jobs WHERE state = 'queued' ORDER BY id LIMIT 1").get();
  if (!job) return false;
  const setJob = (fields) => db.prepare(`UPDATE video_jobs SET ${Object.keys(fields).map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`).run({ ...fields, id: job.id });
  fs.mkdirSync(tmpDir, { recursive: true });
  // The two smaller files together stay well under 2 GB for a long match; keep room for the rest of the server.
  if (freeBytes(tmpDir) < 3 * 1024 ** 3) {
    setJob({ state: 'failed', error: 'Not enough free disk space on the server (needs about 3 GB while converting)' });
    return true;
  }
  setJob({ state: 'running', progress: 0, error: null });
  // Valid for a week (the most S3 allows), so a conversion paused over the day can go on.
  const input = presign(cfg, 'GET', job.source_key, { expires: 7 * 24 * 3600 });
  const outputs = QUALITIES.map((o) => ({ ...o, file: path.join(tmpDir, `job-${job.id}-${o.q}.mp4`) }));
  try {
    const info = await probe(input);
    const total = info.duration;
    // 50/60 frames per second (phones, GoPro) are made 25/30 here: half the work. The original keeps every frame.
    const fps = info.fps && info.fps > 31 ? (Math.abs(info.fps - 50) < 2 ? 25 : 30) : null;
    log(`job ${job.id}: match ${job.match_id}, ${total ? Math.round(total / 60) + ' min' : 'length unknown'}${info.fps ? `, ${Math.round(info.fps)} fps` : ''}`);
    await new Promise((resolve, reject) => {
      // Lowest priority, so the rest of the server stays responsive.
      const p = spawn('nice', ['-n', '19', 'ffmpeg', ...ffmpegArgs(input, outputs, { fps })]);
      let err = '', last = 0, paused = false;
      // Outside the hours: pause ffmpeg where it is, and let it go on when they start again.
      const watch = hours ? setInterval(() => {
        const ok = inHours(hours, new Date(), timeZone);
        if (!ok && !paused) { p.kill('SIGSTOP'); paused = true; setJob({ state: 'paused' }); log(`job ${job.id}: paused until ${hours.split('-')[0]}:00`); }
        else if (ok && paused) { p.kill('SIGCONT'); paused = false; setJob({ state: 'running' }); log(`job ${job.id}: going on`); }
      }, checkEveryMs) : null;
      p.stdout.on('data', (d) => {
        const m = String(d).match(/out_time_us=(\d+)/g);
        if (!m || !total) return;
        const t = Number(m[m.length - 1].split('=')[1]) / 1e6;
        const progress = Math.min(0.99, t / total);
        if (progress - last >= 0.01) { last = progress; setJob({ progress }); }
      });
      p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
      p.on('error', (e) => { clearInterval(watch); reject(e); });
      p.on('close', (code) => { clearInterval(watch); return code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.trim().split('\n').pop() ?? ''}`)); });
    });
    // Still the same video? (A new upload or a delete while converting makes these useless.)
    const match = db.prepare('SELECT video_key FROM matches WHERE id = ?').get(job.match_id);
    if (match?.video_key !== job.source_key) { setJob({ state: 'done', progress: 1, error: 'video replaced meanwhile' }); return true; }
    const variants = {};
    for (const o of outputs) {
      const key = job.source_key.replace(/\.[^./]+$/, '') + `-${o.q}.mp4`;
      variants[o.q] = { key, bytes: await uploadFile(cfg, key, o.file) };
    }
    db.prepare('UPDATE matches SET video_variants = ? WHERE id = ? AND video_key = ?').run(JSON.stringify(variants), job.match_id, job.source_key);
    setJob({ state: 'done', progress: 1 });
    log(`job ${job.id}: done`);
  } catch (e) {
    setJob({ state: 'failed', error: String(e.message ?? e).slice(0, 300) });
    log(`job ${job.id}: failed: ${e.message}`);
  } finally {
    for (const o of outputs) fs.rmSync(o.file, { force: true });
  }
  return true;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const cfg = s3Config(process.env);
  if (!cfg) { console.log('Video storage is not set up (S3_* in .env); the transcoder has nothing to do.'); process.exit(0); }
  const dataDir = path.resolve(process.env.DATA_DIR ?? '../data');
  const db = openDb(dataDir);
  const tmp = path.join(dataDir, 'transcode-tmp');
  // A job that was running when the service stopped starts over.
  db.prepare("UPDATE video_jobs SET state = 'queued', progress = 0 WHERE state IN ('running', 'paused')").run();
  const hours = process.env.TRANSCODE_HOURS?.trim() || null;
  const timeZone = process.env.TRANSCODE_TZ?.trim() || 'Europe/Zurich';
  if (hours) console.log(`converting only between ${hours.replace('-', ':00 and ')}:00 (${timeZone})`);
  console.log('transcoder ready');
  for (;;) {
    const worked = await runOnce(db, cfg, tmp, console.log, { hours, timeZone }).catch((e) => { console.log(e); return false; });
    if (!worked) await new Promise((r) => setTimeout(r, 30_000));
  }
}
