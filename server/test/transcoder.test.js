import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { s3Config } from '../src/s3.js';
import { runOnce } from '../src/transcoder.js';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } })();

test('transcoder: reads the original from the bucket, uploads 720p and 480p, records them', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-tc-'));
  // A short test video, made here.
  const src = path.join(dir, 'src.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=25', '-f', 'lavfi', '-i', 'sine', '-t', '3', '-pix_fmt', 'yuv420p', '-shortest', src]);
  const stored = {};
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'GET') {
        // Like the bucket: byte ranges, so ffmpeg can seek in a phone video (index at the end).
        const b = fs.readFileSync(src);
        const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
        if (!r) { res.writeHead(200, { 'content-length': b.length, 'accept-ranges': 'bytes', 'content-type': 'video/mp4' }); return res.end(b); }
        const from = Number(r[1]), to = r[2] ? Number(r[2]) : b.length - 1;
        res.writeHead(206, { 'content-length': to - from + 1, 'content-range': `bytes ${from}-${to}/${b.length}`, 'accept-ranges': 'bytes', 'content-type': 'video/mp4' });
        return res.end(b.subarray(from, to + 1));
      }
      if (req.method === 'POST' && u.searchParams.has('uploads')) return res.end('<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>');
      if (req.method === 'PUT') { stored[u.pathname] = (stored[u.pathname] ?? 0) + Buffer.concat(chunks).length; res.writeHead(200, { etag: '"e"' }); return res.end(); }
      res.end('');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const cfg = s3Config({ S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`, S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's', S3_PATH_STYLE: 'true', S3_REGION: 'hel1' });
    const db = openDb(dir);
    const m = db.prepare("INSERT INTO matches (label, video_key) VALUES ('m', 'matches/1/abc.mp4')").run().lastInsertRowid;
    db.prepare('INSERT INTO video_jobs (match_id, source_key) VALUES (?, ?)').run(m, 'matches/1/abc.mp4');
    // Pretend there is room on the disk (the check itself is tested by the 3 GB rule).
    assert.equal(await runOnce(db, cfg, path.join(dir, 'tmp'), () => {}), true);
    const job = db.prepare('SELECT * FROM video_jobs').get();
    assert.equal(job.state, 'done', String(job.error));
    const variants = JSON.parse(db.prepare('SELECT video_variants FROM matches').get().video_variants);
    assert.deepEqual(Object.keys(variants).sort(), ['480', '720']);
    assert.equal(variants['720'].key, 'matches/1/abc-720.mp4');
    assert.ok(stored['/b/matches/1/abc-480.mp4'] > 1000);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), [], 'temporary files removed');
    assert.equal(await runOnce(db, cfg, path.join(dir, 'tmp'), () => {}), false, 'nothing left to do');
    db.close();
  } finally {
    server.close();
  }
});

test('transcoder hours: only at night, across midnight, Swiss time', async () => {
  const { inHours } = await import('../src/transcoder.js');
  const at = (iso) => new Date(iso);
  assert.equal(inHours(null, at('2026-11-01T12:00:00Z')), true, 'no hours: always');
  assert.equal(inHours('22-7', at('2026-11-01T21:30:00Z')), true, '22:30 in Zurich (winter, UTC+1)');
  assert.equal(inHours('22-7', at('2026-11-01T20:30:00Z')), false, '21:30 in Zurich');
  assert.equal(inHours('22-7', at('2026-11-02T05:59:00Z')), true, '06:59');
  assert.equal(inHours('22-7', at('2026-11-02T06:00:00Z')), false, '07:00');
  assert.equal(inHours('1-5', at('2026-07-01T00:30:00Z')), true, '02:30 in summer (UTC+2)');
});

test('transcoder: pieces are joined, and pieces done before a restart are not converted again', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-tc2-'));
  const src = path.join(dir, 'src.mp4');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine', '-t', '3', '-pix_fmt', 'yuv420p', '-shortest', src]);
  const bodies = {};
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'GET') {
        const b = fs.readFileSync(src);
        const r = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
        if (!r) { res.writeHead(200, { 'content-length': b.length, 'accept-ranges': 'bytes' }); return res.end(b); }
        const from = Number(r[1]), to = r[2] ? Number(r[2]) : b.length - 1;
        res.writeHead(206, { 'content-length': to - from + 1, 'content-range': `bytes ${from}-${to}/${b.length}`, 'accept-ranges': 'bytes' });
        return res.end(b.subarray(from, to + 1));
      }
      if (req.method === 'POST' && u.searchParams.has('uploads')) return res.end('<UploadId>u1</UploadId>');
      if (req.method === 'PUT') { bodies[u.pathname] = Buffer.concat([bodies[u.pathname] ?? Buffer.alloc(0), ...chunks]); res.writeHead(200, { etag: '"e"' }); return res.end(); }
      res.end('');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const cfg = s3Config({ S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`, S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's', S3_PATH_STYLE: 'true', S3_REGION: 'hel1' });
    const db = openDb(dir);
    db.prepare("INSERT INTO matches (label, video_key) VALUES ('m', 'matches/1/abc.mp4')").run();
    const job = db.prepare('INSERT INTO video_jobs (match_id, source_key) VALUES (1, ?)').run('matches/1/abc.mp4').lastInsertRowid;
    // As if the service had stopped after the first piece: it is on disk and marked done.
    const tmp = path.join(dir, 'tmp');
    const jobDir = path.join(tmp, `job-${job}`);
    fs.mkdirSync(jobDir, { recursive: true });
    for (const q of ['720', '480']) execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine', '-t', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', path.join(jobDir, `piece-000-${q}.mp4`)]);
    fs.writeFileSync(path.join(jobDir, 'piece-0.done'), '');
    const logs = [];
    assert.equal(await runOnce(db, cfg, tmp, (m) => logs.push(m), { pieceSeconds: 1 }), true);
    const row = db.prepare('SELECT * FROM video_jobs').get();
    assert.equal(row.state, 'done', String(row.error));
    assert.match(logs[0], /3 pieces, 1 done before/);
    const out = path.join(dir, 'out-480.mp4');
    fs.writeFileSync(out, bodies['/b/matches/1/abc-480.mp4']);
    const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
    assert.ok(secs > 2.7 && secs < 3.3, `joined length ${secs}`);
    assert.equal(fs.existsSync(jobDir), false, 'pieces removed once uploaded');
    db.close();
  } finally {
    server.close();
  }
});
