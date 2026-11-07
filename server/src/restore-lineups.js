// Brings back the second side's line-ups of practice matches from the nightly backups.
// Saving a set's sides in app versions up to 1.1.1-dev.177 (with the server not yet updated)
// dropped them. Only line-ups that are missing now are filled in, each from the newest backup
// that has it, and only when its players are on that set's sides. Nothing else is changed.
//
//   docker compose -p volleyiq exec app node src/restore-lineups.js           shows what it would do
//   docker compose -p volleyiq exec app node src/restore-lineups.js --apply   does it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { openDb } from './db.js';
import { listObjects, presign, s3Config } from './s3.js';

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/**
 * The line-ups to add: for each current practice match, the sets whose second-side line-up is
 * missing, filled from [backups] (newest first: arrays of { id, practice }). A line-up is only
 * taken when all its players are on one of that set's sides now.
 */
export function plan(current, backups) {
  const out = [];
  for (const m of current) {
    const p = parse(m.practice);
    if (!p) continue;
    const have = p.lineupsB ?? {};
    const add = {};
    for (const set of Object.keys(p.sets ?? {})) {
      if (have[set]) continue;
      const sides = p.sets[set];
      for (const b of backups) {
        const old = parse(b.find((x) => x.id === m.id)?.practice)?.lineupsB?.[set];
        if (!old) continue;
        const ids = old.order.filter((x) => x != null);
        const fits = (side) => ids.every((id) => side.includes(id));
        if (ids.length && (fits(sides.b) || fits(sides.a))) { add[set] = old; break; }
      }
    }
    if (Object.keys(add).length) out.push({ id: m.id, label: m.label, practice: p, add });
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const cfg = s3Config(process.env);
  if (!cfg) { console.log('No video storage set up (S3_* in .env): there are no backups to read.'); return; }
  const db = openDb(path.resolve(process.env.DATA_DIR ?? '../data'));
  const current = db.prepare('SELECT id, label, practice FROM matches WHERE practice IS NOT NULL').all();
  if (!current.length) { console.log('No practice matches.'); return; }
  const keys = (await listObjects(cfg, 'backups/volleyiq-')).map((o) => o.key).sort().reverse();
  console.log(`${keys.length} backup${keys.length === 1 ? '' : 's'} found, newest first.`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viq-restore-'));
  const backups = [];
  try {
    for (const key of keys) {
      const res = await fetch(presign(cfg, 'GET', key, { expires: 600 }));
      if (!res.ok) { console.log(`  ${key}: could not read (${res.status})`); continue; }
      const file = path.join(tmp, 'b.db');
      fs.writeFileSync(file, zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
      const b = new Database(file, { readonly: true });
      backups.push(b.prepare('SELECT id, practice FROM matches WHERE practice IS NOT NULL').all());
      b.close();
      fs.rmSync(file, { force: true });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const todo = plan(current, backups);
  if (!todo.length) { console.log('Nothing to restore: no missing line-up of the second side is in the backups.'); return; }
  for (const t of todo) console.log(`Match ${t.id} "${t.label}": line-ups of the second side for set${Object.keys(t.add).length === 1 ? '' : 's'} ${Object.keys(t.add).join(', ')}`);
  if (!apply) { console.log('\nNothing changed yet. Run again with --apply to restore these.'); return; }
  const save = db.prepare('UPDATE matches SET practice = ? WHERE id = ?');
  for (const t of todo) save.run(JSON.stringify({ ...t.practice, lineupsB: { ...(t.practice.lineupsB ?? {}), ...t.add } }), t.id);
  console.log('\nRestored. Reload the match in the app.');
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error(`Failed: ${e.message}`); process.exit(1); });
}
