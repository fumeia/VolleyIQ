import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'volleyiq.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

const MIGRATIONS = [
  `
  CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    coach TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE players (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    number INTEGER,
    role TEXT NOT NULL DEFAULT 'OH',
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX players_team ON players(team_id);
  CREATE TABLE matches (
    id INTEGER PRIMARY KEY,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    opponent TEXT,
    played_on TEXT,
    mode TEXT NOT NULL DEFAULT 'video',      -- video | live
    video_type TEXT,                         -- youtube | upload | local
    video_ref TEXT,                          -- youtube id or uploaded file name
    share_token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    jersey INTEGER,
    action TEXT NOT NULL,
    value INTEGER,                           -- receive grade 0..3
    zone INTEGER,                            -- court zone 1..6
    t REAL,                                  -- video time in seconds
    set_no INTEGER,
    source TEXT NOT NULL DEFAULT 'manual',   -- manual | auto
    status TEXT NOT NULL DEFAULT 'confirmed',-- confirmed | suggested
    confidence REAL,
    client_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX events_match ON events(match_id, t);
  CREATE UNIQUE INDEX events_client ON events(match_id, client_id) WHERE client_id IS NOT NULL;
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
    progress REAL NOT NULL DEFAULT 0,
    message TEXT,
    options TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v2: exact landing point on the court, in meters (see web/src/lib/court.ts)
  `
  ALTER TABLE events ADD COLUMN x REAL;
  ALTER TABLE events ADD COLUMN y REAL;
  `,
];

function migrate(db) {
  const version = db.pragma('user_version', { simple: true });
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
