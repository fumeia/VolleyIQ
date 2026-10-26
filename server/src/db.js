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
  // v3: analysis moved to the phone app, the server no longer queues jobs
  `
  DROP TABLE IF EXISTS jobs;
  `,
  // v4: rally / possession numbers on auto suggestions, so one review tap can settle a whole rally
  `
  ALTER TABLE events ADD COLUMN rally INTEGER;
  ALTER TABLE events ADD COLUMN poss INTEGER;
  ALTER TABLE matches ADD COLUMN calibration TEXT; -- JSON: { corners: [[u,v] x4], ourHalf: 'near'|'far' }
  `,
  // v5: read-only season report links for teammates
  `
  ALTER TABLE teams ADD COLUMN share_token TEXT;
  CREATE UNIQUE INDEX teams_share ON teams(share_token) WHERE share_token IS NOT NULL;
  `,
  // v6: how an auto suggestion was found: NULL = heard clearly, 'quiet' = faint sound, 'gap' = guessed from the rally rhythm
  `
  ALTER TABLE events ADD COLUMN hint TEXT;
  `,
  // v7: where the ball was played from (fx, fy); x, y stay where it went
  `
  ALTER TABLE events ADD COLUMN fx REAL;
  ALTER TABLE events ADD COLUMN fy REAL;
  `,
  // v8: starting line-up per set, JSON { "1": { order: [6 player ids, position 1..6], libero, weServeFirst } }
  `
  ALTER TABLE matches ADD COLUMN lineups TEXT;
  `,
  // v9: analyst effort per match: active seconds spent tagging/reviewing, auto suggestions
  // removed as wrong, and auto suggestions corrected (other player or action) before saving
  `
  ALTER TABLE matches ADD COLUMN work_sec INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE matches ADD COLUMN removed_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE matches ADD COLUMN edited_count INTEGER NOT NULL DEFAULT 0;
  `,
  // v10: show the pre-written practice tips on the player pages (off until the coach turns them on)
  `
  ALTER TABLE teams ADD COLUMN show_tips INTEGER NOT NULL DEFAULT 0;
  `,
  // v11: the match flow read off the official match sheet (JSON, see sheet.js)
  `
  ALTER TABLE matches ADD COLUMN sheet TEXT;
  `,
  // v12: saved versions of a match's tagging (events, line-ups, court marking, sheet) to go back to
  `
  CREATE TABLE match_versions (
    id INTEGER PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    auto INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX match_versions_match ON match_versions(match_id, id);
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
