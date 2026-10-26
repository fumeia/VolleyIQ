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
  // v13: a 0 pass is no longer a point by itself (some are rescued). Where one ended the
  // rally (next comes a serve or pass, or the set ends), add the opponent's ace after it,
  // so old scores stay as tagged; each changed match is saved as a version first.
  (db) => {
    const RALLY_START = new Set(['serve', 'ace', 'serve_error', 'receive']);
    const COLS = ['player_id', 'jersey', 'action', 'value', 'zone', 'x', 'y', 'fx', 'fy', 'rally', 'poss', 't', 'set_no', 'source', 'status', 'confidence', 'hint', 'client_id'];
    const insert = db.prepare(`INSERT INTO events (match_id, action, value, t, set_no, source, status)
                               VALUES (?, 'opp_point', 3, ?, ?, 'manual', 'confirmed')`);
    for (const m of db.prepare('SELECT * FROM matches').all()) {
      const all = db.prepare('SELECT * FROM events WHERE match_id = ? ORDER BY COALESCE(t, 1e12), id').all(m.id);
      const confirmed = all.filter((e) => e.status === 'confirmed');
      const aces = [];
      confirmed.forEach((e, i) => {
        if (e.action !== 'receive' || e.value !== 0) return;
        const next = confirmed.slice(i + 1).find((x) => (x.set_no ?? 1) === (e.set_no ?? 1));
        if (!next || RALLY_START.has(next.action)) aces.push(e);
      });
      if (!aces.length) continue;
      const data = JSON.stringify({
        events: all.map((e) => Object.fromEntries(COLS.map((k) => [k, e[k]]))),
        lineups: m.lineups ? JSON.parse(m.lineups) : null,
        calibration: m.calibration ? JSON.parse(m.calibration) : null,
        sheet: m.sheet ? JSON.parse(m.sheet) : null,
      });
      db.prepare('INSERT INTO match_versions (match_id, label, auto, event_count, data) VALUES (?, ?, 1, ?, ?)')
        .run(m.id, 'Before the 0-pass scoring change', all.length, data);
      for (const e of aces) insert.run(m.id, e.t == null ? null : e.t + 0.05, e.set_no);
    }
  },
  // v14: the AI check learns from the coach. Its answer per touch (to apply later, e.g.
  // after checking every rally at once), whether each answered field was right once the
  // rally was saved, the coach's corrected touches as examples, and what each call cost.
  (db) => {
    if (!db.prepare('PRAGMA table_info(events)').all().some((c) => c.name === 'ai')) db.exec('ALTER TABLE events ADD COLUMN ai TEXT');
    db.exec(`
  CREATE TABLE IF NOT EXISTS ai_feedback (
    id INTEGER PRIMARY KEY,
    field TEXT NOT NULL,                     -- contact | team | action | jersey | position
    confidence REAL,
    correct INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ai_feedback_field ON ai_feedback(field, id);
  CREATE TABLE IF NOT EXISTS ai_examples (
    id INTEGER PRIMARY KEY,
    image TEXT NOT NULL,                     -- base64 JPEG (the same 2x2 picture the check uses)
    label TEXT NOT NULL,                     -- JSON: contact, team, action, jersey, ourSide
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY,
    task TEXT NOT NULL,                      -- touches | scan | summary
    model TEXT,
    items INTEGER NOT NULL DEFAULT 1,        -- touches checked (examples not counted)
    cost REAL,                               -- as reported by the gateway, else null
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  },
  // v15: corrections sent by viewers of the public link (from the Replays tab), for the
  // coach to accept or reject. [changes] are the new values, [original] what the tag
  // had when they were sent (to see if it changed since).
  `
  CREATE TABLE IF NOT EXISTS edit_suggestions (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    changes TEXT NOT NULL,
    original TEXT NOT NULL,
    note TEXT,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'open',     -- open | accepted | rejected
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );
  CREATE INDEX IF NOT EXISTS edit_suggestions_match ON edit_suggestions(match_id, status);
  `,
  // v16: the shirt number of whoever sent a correction (required, to know who uses it).
  (db) => {
    if (!db.prepare('PRAGMA table_info(edit_suggestions)').all().some((c) => c.name === 'sender_jersey')) db.exec('ALTER TABLE edit_suggestions ADD COLUMN sender_jersey INTEGER');
  },
  // v17: suggestions can also add a touch that was not tagged ('add', at a video time; event_id is set once accepted).
  (db) => {
    if (!db.prepare('PRAGMA table_info(edit_suggestions)').all().some((c) => c.name === 'kind')) db.exec("ALTER TABLE edit_suggestions ADD COLUMN kind TEXT NOT NULL DEFAULT 'edit'");
  },
  // v18: every auto-detection run as it came from the phone (before review changes anything),
  // to measure the detection against the tags saved afterwards.
  `
  CREATE TABLE IF NOT EXISTS detection_runs (
    id INTEGER PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    params TEXT,                             -- JSON: settings of the run, when the app sends them
    events TEXT NOT NULL,                    -- JSON: [{t, action, rally, poss, jersey, confidence, hint, set_no}]
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS detection_runs_match ON detection_runs(match_id, id);
  `,
];

function migrate(db) {
  const version = db.pragma('user_version', { simple: true });
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      if (typeof MIGRATIONS[v] === 'function') MIGRATIONS[v](db);
      else db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
