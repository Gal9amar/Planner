const fs   = require('fs');
const path = require('path');

const LOGS_DIR     = path.join(__dirname, 'logs');
const MAX_DAYS     = 30;
const sseClients   = new Set();

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

function todayFile() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `${y}-${m}-${day}.log`);
}

function writeLog(entry) {
  const line = JSON.stringify(entry) + '\n';
  try { fs.appendFileSync(todayFile(), line); } catch {}
  // broadcast to connected SSE clients (today's logs only)
  for (const res of sseClients) {
    try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch {}
  }
}

function log({ user, action, entityType, entityId, entityName, details, error, ip }) {
  const entry = {
    timestamp:   new Date().toISOString(),
    user_id:     user?.id    ?? null,
    user_email:  user?.email ?? null,
    action,
    entity_type: entityType  ?? null,
    entity_id:   String(entityId ?? ''),
    entity_name: entityName  ?? null,
    details:     details     ?? null,
    error:       error       ?? null,
    ip:          ip          ?? null,
  };
  writeLog(entry);
}

function logError({ error, path: reqPath, method, user, ip }) {
  log({
    user,
    action:     'error',
    entityType: 'server',
    entityName: `${method} ${reqPath}`,
    error:      typeof error === 'object' ? (error.stack || error.message || String(error)) : String(error),
    ip,
  });
}

// Delete log files older than MAX_DAYS
function cleanup() {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_DAYS);
    for (const f of files) {
      const dateStr = f.replace('.log', '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const d = new Date(dateStr);
        if (!isNaN(d) && d < cutoff) {
          try { fs.unlinkSync(path.join(LOGS_DIR, f)); } catch {}
        }
      }
    }
  } catch {}
}

// Run cleanup once on startup and then every 6 hours
cleanup();
setInterval(cleanup, 6 * 60 * 60 * 1000);

// Read a specific day's log file, returns array of parsed entries
function readLogFile(dateStr) {
  const file = path.join(LOGS_DIR, `${dateStr}.log`);
  if (!fs.existsSync(file)) return [];
  try {
    return fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// List available log file dates (sorted descending)
function listLogDates() {
  try {
    return fs.readdirSync(LOGS_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map(f => f.replace('.log', ''))
      .sort((a, b) => b.localeCompare(a));
  } catch { return []; }
}

// SSE handler — streams today's real-time logs to superadmin
function sseHandler(req, res) {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  // Send a keep-alive comment every 20s
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20_000);
  sseClients.add(res);
  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
}

module.exports = { log, logError, readLogFile, listLogDates, sseHandler };
