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

/** ffmpeg arguments: one decode, both sizes written at once, ready to stream (faststart). */
export function ffmpegArgs(input, outputs) {
  // Reconnects when the connection to the bucket drops during a long match.
  const net = /^https?:/.test(input) ? ['-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_delay_max', '30'] : [];
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', ...net, '-i', input];
  for (const o of outputs) {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=-2:${o.height}`, '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-crf', String(o.crf),
      '-maxrate', o.maxrate, '-bufsize', o.maxrate.replace(/k$/, '') * 2 + 'k', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', o.audio, '-movflags', '+faststart', '-y', o.file);
  }
  return args;
}

/** Length of a video in seconds (ffprobe), for the progress. */
function duration(input) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(Number(out.trim()) || null));
    p.on('error', () => resolve(null));
  });
}

const freeBytes = (dir) => { const s = fs.statfsSync(dir); return s.bavail * s.bsize; };

export async function runOnce(db, cfg, tmpDir, log = console.log) {
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
  const input = presign(cfg, 'GET', job.source_key, { expires: 12 * 3600 });
  const outputs = QUALITIES.map((o) => ({ ...o, file: path.join(tmpDir, `job-${job.id}-${o.q}.mp4`) }));
  try {
    const total = await duration(input);
    log(`job ${job.id}: match ${job.match_id}, ${total ? Math.round(total / 60) + ' min' : 'length unknown'}`);
    await new Promise((resolve, reject) => {
      // Lowest priority, so the rest of the server stays responsive.
      const p = spawn('nice', ['-n', '19', 'ffmpeg', ...ffmpegArgs(input, outputs)]);
      let err = '', last = 0;
      p.stdout.on('data', (d) => {
        const m = String(d).match(/out_time_us=(\d+)/g);
        if (!m || !total) return;
        const t = Number(m[m.length - 1].split('=')[1]) / 1e6;
        const progress = Math.min(0.99, t / total);
        if (progress - last >= 0.01) { last = progress; setJob({ progress }); }
      });
      p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.trim().split('\n').pop() ?? ''}`))));
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
  db.prepare("UPDATE video_jobs SET state = 'queued', progress = 0 WHERE state = 'running'").run();
  console.log('transcoder ready');
  for (;;) {
    const worked = await runOnce(db, cfg, tmp).catch((e) => { console.log(e); return false; });
    if (!worked) await new Promise((r) => setTimeout(r, 30_000));
  }
}
