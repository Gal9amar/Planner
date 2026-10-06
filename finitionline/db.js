// FinitiOnline - מסד הנתונים (better-sqlite3, WAL) + סכימה + מיגרציות אידמפוטנטיות
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.FINITIONLINE_DB || path.join(DATA_DIR, 'finitionline.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- הגדרות יחידות (שורה אחת, id=1)
  CREATE TABLE IF NOT EXISTS settings (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    site_name        TEXT NOT NULL DEFAULT 'FinitiOnline',
    logo_url         TEXT,
    list_name        TEXT,                 -- שם הרשימה שהעובדים מקלידים בכניסה
    join_code        TEXT,                 -- קוד הצטרפות בן 6 ספרות
    recipients       TEXT,                 -- כתובות מייל מופרדות בפסיק; ריק = מייל המנהל
    setup_completed  INTEGER NOT NULL DEFAULT 0,
    last_weekly_send TEXT,                 -- YYYY-MM-DD של השליחה השבועית האחרונה
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- המנהל (שורה אחת בפועל - המייל נקבע ב-.env)
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    email      TEXT UNIQUE NOT NULL,
    role       TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY,
    email      TEXT NOT NULL,
    code       TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locked_accounts (
    email        TEXT PRIMARY KEY,
    attempts     INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT NOT NULL
  );

  -- סשנים: admin (לפי מייל) או member (עובד שנכנס עם שם רשימה + קוד)
  CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    role         TEXT NOT NULL,            -- admin | member
    email        TEXT,
    display_name TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL
  );

  -- הרשימה הפעילה (אחת לכל פריסה)
  CREATE TABLE IF NOT EXISTS list_items (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    name_norm  TEXT NOT NULL,
    qty        REAL NOT NULL DEFAULT 1,
    note       TEXT,
    checked    INTEGER NOT NULL DEFAULT 0,
    added_by   TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_list_items_norm ON list_items (name_norm);

  -- גרסת הרשימה - עולה בכל שינוי; הלקוח פולל אותה ומושך את הרשימה רק כשהיא השתנתה
  CREATE TABLE IF NOT EXISTS list_meta (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO list_meta (id, version) VALUES (1, 0);

  -- כל שם שהוקלד אי פעם - להשלמה אוטומטית
  CREATE TABLE IF NOT EXISTS item_catalog (
    name_norm    TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    use_count    INTEGER NOT NULL DEFAULT 1,
    last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- רשימות שנסגרו/נשלחו - היסטוריה
  CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    items_count INTEGER NOT NULL,
    payload     TEXT NOT NULL,             -- JSON: [{name, qty, note, added_by, checked}]
    source      TEXT NOT NULL DEFAULT 'manual',   -- manual | weekly | history
    created_by  TEXT,
    sent_to     TEXT,
    sent_at     TEXT,
    sent_ok     INTEGER
  );
`);

// ─── מיגרציות (ALTER TABLE אידמפוטנטי, כמו ב-Planner) ────────────────────────
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    console.log(`[db] migration: added ${table}.${column}`);
  }
}
addColumnIfMissing('settings', 'last_weekly_send', 'TEXT');
addColumnIfMissing('orders', 'created_by', 'TEXT');
addColumnIfMissing('item_catalog', 'image', 'TEXT');   // תמונת מוצר שהמנהל העלה (data URL מוקטן)

// ─── עזרים משותפים ───────────────────────────────────────────────────────────
function nowIso() {
  return new Date().toISOString();
}

function normName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getSettings() {
  return db.prepare(`SELECT * FROM settings WHERE id = 1`).get() || null;
}

function bumpVersion() {
  db.prepare(`UPDATE list_meta SET version = version + 1 WHERE id = 1`).run();
}

function getVersion() {
  return db.prepare(`SELECT version FROM list_meta WHERE id = 1`).get().version;
}

function touchCatalog(displayName) {
  const norm = normName(displayName);
  if (!norm) return;
  db.prepare(`
    INSERT INTO item_catalog (name_norm, display_name, use_count, last_used_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(name_norm) DO UPDATE SET
      use_count = use_count + 1,
      display_name = excluded.display_name,
      last_used_at = datetime('now')
  `).run(norm, displayName.replace(/\s+/g, ' ').trim());
}

module.exports = db;
module.exports.DB_PATH = DB_PATH;
module.exports.nowIso = nowIso;
module.exports.normName = normName;
module.exports.getSettings = getSettings;
module.exports.bumpVersion = bumpVersion;
module.exports.getVersion = getVersion;
module.exports.touchCatalog = touchCatalog;
