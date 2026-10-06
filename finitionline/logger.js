// FinitiOnline - לוג יומי לקובץ (logs/YYYY-MM-DD.log), אותו דפוס כמו ב-Planner
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, 'logs');
const MAX_DAYS = 30;

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

function todayFile() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `${y}-${m}-${day}.log`);
}

function writeLog(entry) {
  try { fs.appendFileSync(todayFile(), JSON.stringify(entry) + '\n'); } catch {}
}

function log({ user, action, entity, details, error, ip }) {
  writeLog({
    timestamp: new Date().toISOString(),
    user: user ? (user.email || user.display_name || user.role) : null,
    role: user?.role ?? null,
    action,
    entity: entity ?? null,
    details: details ?? null,
    error: error ?? null,
    ip: ip ?? null,
  });
}

function logError({ error, path: reqPath, method, user, ip }) {
  log({
    user,
    action: 'error',
    entity: `${method} ${reqPath}`,
    error: typeof error === 'object' ? (error.stack || error.message || String(error)) : String(error),
    ip,
  });
}

function cleanup() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_DAYS);
    for (const f of fs.readdirSync(LOGS_DIR)) {
      const m = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (!m) continue;
      const d = new Date(m[1]);
      if (!isNaN(d) && d < cutoff) {
        try { fs.unlinkSync(path.join(LOGS_DIR, f)); } catch {}
      }
    }
  } catch {}
}
cleanup();
setInterval(cleanup, 6 * 60 * 60 * 1000).unref();

module.exports = { log, logError };
