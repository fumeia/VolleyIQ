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
