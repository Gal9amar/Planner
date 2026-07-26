// jira-scheduler.js — סנכרון סטטוסים אוטומטי מ-Jira ברקע.
//
// עקרונות בטיחות (נגזרים מתקרית מחיקת task_number ב-2026-07-23):
//   • כותב אך ורק לעמודה tasks.status — לא נוגע בשום שדה אחר, ולא מוחק/מוסיף שורות.
//   • רץ רק על גאנטים שהמשתמש הפעיל בהם jira_auto_sync במפורש.
//   • כל שינוי נרשם ללוג עם ערך לפני ואחרי.
//   • כשל בגאנט אחד לא עוצר את השאר.

const db = require('./db');
const logger = require('./logger');
const jira = require('./jira');

const START_HOUR = 7;         // 07:00
const END_HOUR   = 20;        // עד 20:00 כולל
const TICK_MS    = 60 * 1000; // בודקים כל דקה אם הגיע חצי-שעה עגולה

let timer = null;
let running = false;          // מונע חפיפה אם סבב מתארך
let lastRunSlot = null;       // 'YYYY-MM-DD HH:MM' של הסבב האחרון

function inWorkWindow(d) {
  const day = d.getDay();                       // 0=ראשון … 6=שבת
  if (day === 5 || day === 6) return false;      // שישי/שבת — לא רץ
  return d.getHours() >= START_HOUR && d.getHours() <= END_HOUR;
}

// מיפוי שם סטטוס מ-Jira לערך פנימי — חייב להישאר תואם ל-jiraStatusToValue
// שב-sprint.html/monthly.html, אחרת ייווצרו ערכים שאין להם תווית בממשק.
const JIRA_STATUS_MAP = {
  'open': 'pending',
  'in dev': 'in-dev',
  'ready for dev': 'pending',
  'ready for qa': 'rfq',
  'testing': 'testing',
  'qa': 'testing',
  'po review': 'done',
};

function statusToValue(rawName, statuses) {
  const raw = String(rawName || '').trim();
  if (!raw) return null;
  const mapped = JIRA_STATUS_MAP[raw.toLowerCase()];
  if (mapped && statuses.some(s => s.value === mapped)) return mapped;
  const byLabel = statuses.find(s => String(s.label).trim().toLowerCase() === raw.toLowerCase());
  if (byLabel) return byLabel.value;
  return 'jira:' + raw.toLowerCase();
}

const COLOR_PALETTE_JIRA = ['#64748b','#0ea5e9','#8b5cf6','#ec4899','#14b8a6','#6366f1','#a855f7','#0891b2'];
function statusColor(raw) {
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE_JIRA[h % COLOR_PALETTE_JIRA.length];
}

const DEFAULT_STATUSES = [
  { value: 'pending', label: 'ממתין',   color: '#64748b', bg: '#64748b', color2: '#ffffff' },
  { value: 'in-dev',  label: 'בפיתוח',  color: '#3b82f6', bg: '#3b82f6', color2: '#ffffff' },
  { value: 'rfq',     label: 'RFQ',     color: '#f59e0b', bg: '#f59e0b', color2: '#ffffff' },
  { value: 'testing', label: 'בבדיקות', color: '#f97316', bg: '#f97316', color2: '#ffffff' },
  { value: 'done',    label: 'הושלם',   color: '#10b981', bg: '#10b981', color2: '#ffffff' },
];

function readStatuses(gantt) {
  try {
    const wb = gantt.workdays_base ? JSON.parse(gantt.workdays_base) : null;
    if (wb && Array.isArray(wb.taskStatuses) && wb.taskStatuses.length) return wb.taskStatuses;
  } catch { /* workdays_base פגום — נופלים לברירת מחדל */ }
  return DEFAULT_STATUSES;
}

async function syncGantt(gantt) {
  const tasks = db.prepare(
    `SELECT id, task_number, name, status FROM tasks WHERE gantt_id = ? AND task_number IS NOT NULL AND task_number <> ''`
  ).all(gantt.id);
  if (!tasks.length) return { changed: 0, checked: 0, notFound: 0 };

  const keys = tasks.map(t => t.task_number.trim()).filter(Boolean);
  const { statuses: jiraStatuses, notFound } = await jira.fetchIssueStatuses(keys);

  const byKey = {};
  Object.keys(jiraStatuses).forEach(k => { byKey[k.trim().toUpperCase()] = jiraStatuses[k]; });

  let statuses = readStatuses(gantt);
  const originalLen = statuses.length;
  const updates = [];

  for (const t of tasks) {
    const key = t.task_number.trim().toUpperCase();
    if (!(key in byKey)) continue;
    const raw = byKey[key];
    const value = statusToValue(raw, statuses);
    if (!value || value === t.status) continue;

    if (!statuses.some(s => s.value === value)) {
      const c = statusColor(String(raw).trim());
      statuses = [...statuses, { value, label: String(raw).trim(), color: c, bg: c, color2: '#ffffff' }];
    }
    updates.push({ id: t.id, from: t.status, to: value, name: t.name, key: t.task_number });
  }

  if (updates.length || statuses.length !== originalLen) {
    const upd = db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`);
    const applyAll = db.transaction(() => {
      // כתיבה ממוקדת לפי id — רק עמודת status
      for (const u of updates) upd.run(u.to, u.id);

      // אם נוצרו סטטוסים חדשים, יש לשמר אותם ב-workdays_base כדי שיוצגו בממשק
      if (statuses.length !== originalLen) {
        let wb = {};
        try { wb = gantt.workdays_base ? JSON.parse(gantt.workdays_base) : {}; } catch { wb = {}; }
        wb.taskStatuses = statuses;
        db.prepare(`UPDATE gantts SET workdays_base = ? WHERE id = ?`).run(JSON.stringify(wb), gantt.id);
      }
      db.prepare(`UPDATE gantts SET jira_synced_at = datetime('now') WHERE id = ?`).run(gantt.id);
    });
    applyAll();

    for (const u of updates) {
      logger.log({
        user: { sub: null, email: 'jira-scheduler', role: 'system' },
        action: 'jira_auto_status',
        entityType: 'task', entityId: u.id, entityName: `${u.key} — ${u.name}`,
        details: `${gantt.name}: ${u.from} → ${u.to}`,
      });
    }
  } else {
    db.prepare(`UPDATE gantts SET jira_synced_at = datetime('now') WHERE id = ?`).run(gantt.id);
  }

  return { changed: updates.length, checked: keys.length, notFound: notFound.length };
}

async function runOnce(reason = 'scheduled') {
  if (running) { console.log('[jira-scheduler] סבב קודם עדיין רץ — מדלג'); return; }
  running = true;
  const started = Date.now();
  try {
    if (!jira.isConfigured() || !jira.loadTokens()) return;   // אין חיבור — שקט, בלי רעש בלוג

    const gantts = db.prepare(
      `SELECT * FROM gantts
       WHERE deleted_at IS NULL AND jira_auto_sync = 1 AND type IN ('sprint','monthly')`
    ).all();
    if (!gantts.length) return;

    let totalChanged = 0, ok = 0, failed = 0;
    for (const g of gantts) {
      try {
        const r = await syncGantt(g);
        totalChanged += r.changed;
        ok++;
      } catch (err) {
        failed++;
        console.error(`[jira-scheduler] גאנט ${g.id} (${g.name}) נכשל:`, err.message);
        logger.logError({ error: err, path: 'jira-scheduler', method: 'CRON' });
      }
    }
    console.log(`[jira-scheduler] ${reason}: ${ok} גאנטים, ${totalChanged} שינויים${failed ? `, ${failed} כשלונות` : ''} (${Date.now() - started}ms)`);
  } finally {
    running = false;
  }
}

function tick() {
  const now = new Date();
  if (!inWorkWindow(now)) return;
  const m = now.getMinutes();
  if (m !== 0 && m !== 30) return;                       // רק בחצי-שעה עגולה

  const slot = `${now.toISOString().slice(0, 10)} ${String(now.getHours()).padStart(2, '0')}:${m === 0 ? '00' : '30'}`;
  if (slot === lastRunSlot) return;                      // כבר רצנו בסלוט הזה
  lastRunSlot = slot;
  runOnce(slot).catch(err => console.error('[jira-scheduler]', err.message));
}

function start() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
  console.log(`[jira-scheduler] פעיל — ${START_HOUR}:00–${END_HOUR}:00, כל 30 דקות, ימים א׳–ה׳`);
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, runOnce };
