// Nightly backups of the database into the video bucket: a consistent copy (SQLite's own
// backup, safe while the app runs), gzipped, under backups/, the newest [keep] kept.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { deleteObject, listObjects, uploadFile } from './s3.js';

const PREFIX = 'backups/volleyiq-';

export function makeBackups(db, { storage, dataDir, fetchFn = fetch, keep = 14, log = () => {} }) {
  const status = () => {
    const r = db.prepare("SELECT data FROM sv_cache WHERE key = 'backup:last'").get();
    return r ? JSON.parse(r.data) : null;
  };
  const save = (s) => db.prepare("INSERT INTO sv_cache (key, data) VALUES ('backup:last', ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, fetched_at = datetime('now')").run(JSON.stringify(s));

  async function run() {
    if (!storage) throw new Error('Backups go to the video bucket: set up S3_* in .env first');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(dataDir, 'backup-tmp');
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, `volleyiq-${stamp}.db`);
    const gz = `${copy}.gz`;
    try {
      await db.backup(copy);
      await pipeline(fs.createReadStream(copy), zlib.createGzip({ level: 9 }), fs.createWriteStream(gz));
      const key = `${PREFIX}${stamp}.db.gz`;
      const bytes = await uploadFile(storage, key, gz, { fetchFn });
      // Only the newest [keep] stay (keys sort by date).
      const old = (await listObjects(storage, PREFIX, { fetchFn })).map((o) => o.key).sort().slice(0, -keep);
      for (const k of old) await deleteObject(storage, k, { fetchFn }).catch(() => {});
      const s = { ok: true, at: new Date().toISOString(), key, bytes, kept: keep };
      save(s);
      log(`backup: ${key} (${Math.round(bytes / 1024)} KB)`);
      return s;
    } catch (e) {
      const s = { ok: false, at: new Date().toISOString(), error: String(e.message ?? e).slice(0, 200), lastOk: status()?.ok ? status() : status()?.lastOk ?? null };
      save(s);
      log(`backup failed: ${e.message}`);
      throw e;
    } finally {
      fs.rmSync(copy, { force: true });
      fs.rmSync(gz, { force: true });
    }
  }

  async function list() {
    if (!storage) return [];
    return (await listObjects(storage, PREFIX, { fetchFn })).sort((a, b) => (a.key < b.key ? 1 : -1));
  }

  /** Once a day around 3:00 (server time): looks every half hour whether today's backup is done. */
  function start() {
    const tick = () => {
      if (!storage) return;
      const s = status();
      const last = s?.ok ? s.at : s?.lastOk?.at;
      const due = !last || Date.now() - Date.parse(last) > 20 * 3600 * 1000;
      if (due && new Date().getHours() >= 3) run().catch(() => {});
    };
    const t = setInterval(tick, 30 * 60 * 1000);
    t.unref?.();
    setTimeout(tick, 5 * 60 * 1000).unref?.();
    return () => clearInterval(t);
  }

  return { run, list, status, start };
}
