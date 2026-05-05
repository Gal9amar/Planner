require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH
  ? path.resolve(__dirname, process.env.DB_PATH)
  : path.join(__dirname, 'data', 'workgant.db');

const db = new Database(dbPath);

db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL CHECK(type IN ('annual','monthly','sprint')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS gantts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id   INTEGER NOT NULL REFERENCES categories(id),
    name          TEXT    NOT NULL,
    type          TEXT    NOT NULL CHECK(type IN ('annual','monthly','sprint')),
    year          INTEGER,
    month         INTEGER,
    hours_per_day REAL    DEFAULT 8.5,
    workdays_base TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    deleted_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS roles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    gantt_id   INTEGER NOT NULL REFERENCES gantts(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS employees (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    gantt_id               INTEGER NOT NULL REFERENCES gantts(id) ON DELETE CASCADE,
    name                   TEXT    NOT NULL,
    team                   TEXT    NOT NULL,
    vacation_json          TEXT,
    hours_override_json    TEXT,
    workdays_json          TEXT,
    day_off_json           TEXT,
    hours_per_day_override REAL    DEFAULT 0,
    sort_order             INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    gantt_id    INTEGER NOT NULL REFERENCES gantts(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    owner       TEXT    NOT NULL DEFAULT '',
    type        TEXT    NOT NULL DEFAULT '',
    planned     TEXT    NOT NULL DEFAULT '0',
    months_json TEXT,
    days_json   TEXT,
    notes       TEXT    NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sprints (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    gantt_id   INTEGER NOT NULL REFERENCES gantts(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    dates      TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sprint_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sprint_id  INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    task_name  TEXT    NOT NULL DEFAULT '',
    type       TEXT    NOT NULL DEFAULT '',
    plan       REAL    NOT NULL DEFAULT 0,
    done       REAL    NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS teams (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    role       TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

// Fix CHECK constraints to include 'sprint' type (recreate tables if needed)
{
  const catSql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='categories'`).get()?.sql || '';
  const ganttSql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='gantts'`).get()?.sql || '';
  if (!catSql.includes("'sprint'") || !ganttSql.includes("'sprint'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE IF NOT EXISTS categories_new (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        type       TEXT    NOT NULL CHECK(type IN ('annual','monthly','sprint')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      );
      INSERT OR IGNORE INTO categories_new SELECT * FROM categories;
      DROP TABLE categories;
      ALTER TABLE categories_new RENAME TO categories;

      CREATE TABLE IF NOT EXISTS gantts_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id   INTEGER NOT NULL REFERENCES categories(id),
        name          TEXT    NOT NULL,
        type          TEXT    NOT NULL CHECK(type IN ('annual','monthly','sprint')),
        year          INTEGER,
        month         INTEGER,
        hours_per_day REAL    DEFAULT 8.5,
        workdays_base TEXT,
        sprint_start  TEXT    DEFAULT NULL,
        sprint_end    TEXT    DEFAULT NULL,
        freeze_date   TEXT    DEFAULT NULL,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        deleted_at    TEXT
      );
      INSERT OR IGNORE INTO gantts_new
        SELECT id, category_id, name, type, year, month, hours_per_day, workdays_base,
               sprint_start, sprint_end, freeze_date, sort_order, created_at, deleted_at
        FROM gantts;
      DROP TABLE gantts;
      ALTER TABLE gantts_new RENAME TO gantts;

      PRAGMA foreign_keys = ON;
    `);
  }
}

// Cleanup orphaned data from previously soft-deleted gantts (one-time, idempotent)
{
  const deleted = db.prepare(`SELECT id FROM gantts WHERE deleted_at IS NOT NULL`).all();
  if (deleted.length) {
    const cleanup = db.transaction(() => {
      for (const { id } of deleted) {
        const sprints = db.prepare(`SELECT id FROM sprints WHERE gantt_id = ?`).all(id);
        if (sprints.length) {
          db.prepare(
            `DELETE FROM sprint_items WHERE sprint_id IN (${sprints.map(() => '?').join(',')})`
          ).run(...sprints.map(s => s.id));
        }
        db.prepare(`DELETE FROM sprints   WHERE gantt_id = ?`).run(id);
        db.prepare(`DELETE FROM tasks     WHERE gantt_id = ?`).run(id);
        db.prepare(`DELETE FROM employees WHERE gantt_id = ?`).run(id);
        db.prepare(`DELETE FROM roles     WHERE gantt_id = ?`).run(id);
      }
    });
    cleanup();
  }
}

// Add columns introduced after initial schema (safe to run multiple times)
for (const [table, col, def] of [
  ['tasks',  'status',         "TEXT NOT NULL DEFAULT 'pending'"],
  ['tasks',  'start_day',      'INTEGER DEFAULT NULL'],
  ['tasks',  'task_number',    "TEXT NOT NULL DEFAULT ''"],
  ['tasks',  'priority',       'INTEGER DEFAULT NULL'],
  ['tasks',  'qa_planned',     'REAL NOT NULL DEFAULT 0'],
  ['tasks',  'qa_months_json', 'TEXT DEFAULT NULL'],
  ['gantts', 'sprint_start',   'TEXT DEFAULT NULL'],
  ['gantts', 'sprint_end',     'TEXT DEFAULT NULL'],
  ['gantts', 'freeze_date',    'TEXT DEFAULT NULL'],
]) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch {}
}

// ── Auth tables ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT   NOT NULL,
    role         TEXT    NOT NULL CHECK(role IN ('superadmin','admin','editor','viewer')) DEFAULT 'viewer',
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login   TEXT,
    created_by   INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_gantt_permissions (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gantt_id INTEGER NOT NULL REFERENCES gantts(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, gantt_id)
  );

  CREATE TABLE IF NOT EXISTS user_category_permissions (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, category_id)
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL UNIQUE,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    revoked_at  TEXT,
    ip          TEXT,
    user_agent  TEXT
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL COLLATE NOCASE,
    ip         TEXT,
    success    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrate old roles: 'member' → 'viewer'
try {
  db.prepare(`UPDATE users SET role='viewer' WHERE role='member'`).run();
} catch {}

// Recreate users table if CHECK constraint doesn't include 'editor'
{
  const userSql = db.prepare(`SELECT sql FROM sqlite_master WHERE name='users'`).get()?.sql || '';
  if (!userSql.includes("'editor'")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE IF NOT EXISTS users_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        email        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT   NOT NULL,
        role         TEXT    NOT NULL CHECK(role IN ('superadmin','admin','editor','viewer')) DEFAULT 'viewer',
        is_active    INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        last_login   TEXT,
        created_by   INTEGER REFERENCES users_new(id)
      );
      INSERT OR IGNORE INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      PRAGMA foreign_keys = ON;
    `);
  }
}

// ── OTP / Locked accounts tables ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL COLLATE NOCASE,
    code       TEXT    NOT NULL,
    expires_at TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locked_accounts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    attempts     INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT    NOT NULL,
    locked_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    unlocked_by  INTEGER REFERENCES users(id),
    unlocked_at  TEXT
  );
`);

// ── Audit log table ───────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_email  TEXT,
    action      TEXT    NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    entity_name TEXT,
    details     TEXT,
    error       TEXT,
    ip          TEXT
  );
`);

// Ensure gal@finitione.com is always superadmin
try {
  db.prepare(`UPDATE users SET role='superadmin' WHERE email='gal@finitione.com' COLLATE NOCASE`).run();
} catch {}

// Seed superadmin user if no users exist
{
  const bcrypt = require('bcryptjs');
  const count = db.prepare(`SELECT COUNT(*) as c FROM users`).get().c;
  if (count === 0) {
    const hash = bcrypt.hashSync('2010200', 12);
    db.prepare(`INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'superadmin')`)
      .run('gal@finitione.com', hash);
    console.log('[auth] Superadmin user created: gal@finitione.com');
  }
}

module.exports = db;
