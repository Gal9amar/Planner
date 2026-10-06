// FinitiOnline - השליחה השבועית האוטומטית של הרשימה (יום שלישי 08:00, שעון ישראל)
//
// לולאה פשוטה כל 30 שניות, בלי תלות חיצונית. התאריך של השליחה האחרונה נשמר
// ב-settings.last_weekly_send (לא בזיכרון) כדי ש-restart של PM2 באותו בוקר לא ישלח פעמיים.
const db = require('./db');
const logger = require('./logger');

const TZ = 'Asia/Jerusalem';
const SEND_WEEKDAY = 2;   // 0=ראשון ... 2=שלישי
const SEND_HOUR = 8;
const POLL_MS = 30 * 1000;

let _sendFn = null;
let _running = false;

// חלקי התאריך בשעון ישראל, בלי תלות בשעון המכונה
function israelNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
  }).formatToParts(new Date()).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? 0 : parts.hour),
    weekday,
  };
}

async function tick() {
  if (_running || !_sendFn) return;
  const now = israelNow();
  if (now.weekday !== SEND_WEEKDAY || now.hour !== SEND_HOUR) return;
  const s = db.getSettings();
  if (!s || s.last_weekly_send === now.date) return;

  _running = true;
  try {
    db.prepare(`UPDATE settings SET last_weekly_send = ? WHERE id = 1`).run(now.date);
    console.log('[scheduler] שליחה שבועית אוטומטית של הרשימה');
    const result = await _sendFn({ source: 'weekly', createdBy: 'שליחה שבועית אוטומטית' });
    logger.log({ action: 'weekly_send', details: result });
    console.log(`[scheduler] תוצאה: ${JSON.stringify(result)}`);
  } catch (err) {
    logger.log({ action: 'weekly_send_failed', error: err.message });
    console.error('[scheduler] השליחה השבועית נכשלה:', err.message);
  } finally {
    _running = false;
  }
}

// sendFn({source, createdBy}) → Promise<{ok, reason?, order_id?, recipients?}> - מגיע מ-server.js
function start(sendFn) {
  _sendFn = sendFn;
  setInterval(() => { tick().catch(() => {}); }, POLL_MS).unref();
  console.log(`[scheduler] תוזמן: שליחת הרשימה בכל יום שלישי ${String(SEND_HOUR).padStart(2, '0')}:00 (${TZ})`);
}

module.exports = { start, israelNow, SEND_WEEKDAY, SEND_HOUR };
