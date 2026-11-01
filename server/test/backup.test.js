import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { buildApp } from '../src/index.js';
import { s3Config } from '../src/s3.js';

test('backups: a consistent copy, gzipped into the bucket, the newest kept', async () => {
  const bucket = new Map();   // key -> Buffer
  const uploads = new Map();  // uploadId -> parts
  const fake = async (url, o = {}) => {
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.replace(/^\/vids\//, ''));
    const ok = (text = '', headers = {}) => ({ ok: true, status: 200, text: async () => text, headers: new Headers(headers) });
    if (o.method === 'POST' && u.searchParams.has('uploads')) { uploads.set('u', []); return ok('<UploadId>u</UploadId>'); }
    if (o.method === 'PUT') { uploads.get('u').push(Buffer.from(o.body)); return ok('', { etag: '"e"' }); }
    if (o.method === 'POST' && u.searchParams.has('uploadId')) { bucket.set(key, Buffer.concat(uploads.get('u'))); return ok(''); }
    if (o.method === 'DELETE') { bucket.delete(key); return ok(''); }
    if (o.method === 'GET' && u.searchParams.get('list-type') === '2') {
      const p = u.searchParams.get('prefix');
      return ok(`<ListBucketResult>${[...bucket.keys()].filter((k) => k.startsWith(p)).map((k) => `<Contents><Key>${k}</Key><Size>${bucket.get(k).length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    return { ok: false, status: 404, text: async () => '' };
  };
  const storage = s3Config({ S3_ENDPOINT: 'https://hel1.example.com', S3_BUCKET: 'vids', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's', S3_PATH_STYLE: 'true' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-bak-'));
  const app = await buildApp({ NODE_ENV: 'test', DATA_DIR: dir, WEB_DIST: path.join(dir, 'none'), BACKUP_KEEP: '2' }, { storage, storageFetch: fake });
  await app.inject({ method: 'POST', url: '/api/teams', payload: { name: 'Herren 2' } });

  for (let i = 0; i < 3; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/backup' });
    assert.equal(r.statusCode, 200, r.body);
    await new Promise((res) => setTimeout(res, 1100));   // keys are per second
  }
  const keys = [...bucket.keys()].filter((k) => k.startsWith('backups/'));
  assert.equal(keys.length, 2, 'only the newest two kept');
  const st = (await app.inject({ url: '/api/backup' })).json();
  assert.equal(st.enabled, true);
  assert.equal(st.last.ok, true);
  assert.equal(st.backups.length, 2);

  // The backup is a working database with the data.
  const file = path.join(dir, 'restored.db');
  fs.writeFileSync(file, zlib.gunzipSync(bucket.get(st.last.key)));
  const restored = new Database(file, { readonly: true });
  assert.equal(restored.prepare('SELECT name FROM teams').get().name, 'Herren 2');
  restored.close();
  assert.equal(fs.readdirSync(path.join(dir, 'backup-tmp')).length, 0, 'no copies left behind');
  await app.close();

  const off = await buildApp({ NODE_ENV: 'test', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'viq-bak-')), WEB_DIST: path.join(dir, 'none') }, { storage: null });
  assert.equal((await off.inject({ url: '/api/backup' })).json().enabled, false);
  assert.equal((await off.inject({ method: 'POST', url: '/api/backup' })).statusCode, 502);
  await off.close();
});
