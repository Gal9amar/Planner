// FinitiOnline - הזדהות.
// העמוד הראשי פתוח לכל עובדי החברה (רשת פנימית, אין גישה חיצונית) - אין התחברות.
// רק פעולות ניהול (הגדרות, ניקוי מלא, שליחה מיידית) דורשות מנהל: OTP למייל הקבוע ב-.env.
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const logger = require('./logger');
const mailer = require('./mailer');

const router = express.Router();

const ADMIN_EMAIL = String(process.env.FINITIONLINE_ADMIN_EMAIL || '').trim().toLowerCase();
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 30;
const OTP_TTL_MIN = 10;
const LOCK_MAX_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 10;

function adminEmail() {
  if (!ADMIN_EMAIL) throw Object.assign(new Error('לא הוגדר FINITIONLINE_ADMIN_EMAIL ב-.env'), { status: 500 });
  return ADMIN_EMAIL;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

// ─── נעילה אחרי ניסיונות כושלים (אותו דפוס כמו ב-Planner) ───────────────────
function isLocked(email) {
  const row = db.prepare(`SELECT * FROM locked_accounts WHERE email = ?`).get(email);
  if (!row) return null;
  if (new Date(row.locked_until) > new Date()) return row;
  db.prepare(`DELETE FROM locked_accounts WHERE email = ?`).run(email);
  return null;
}

function recordFailedAttempt(email) {
  const existing = db.prepare(`SELECT * FROM locked_accounts WHERE email = ?`).get(email);
  const attempts = (existing?.attempts || 0) + 1;
  const lockedUntil = attempts >= LOCK_MAX_ATTEMPTS
    ? new Date(Date.now() + LOCK_DURATION_MIN * 60 * 1000).toISOString()
    : new Date(0).toISOString();
  db.prepare(`
    INSERT INTO locked_accounts (email, attempts, locked_until) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET attempts = excluded.attempts, locked_until = excluded.locked_until
  `).run(email, attempts, lockedUntil);
  return attempts;
}

function clearFailedAttempts(email) {
  db.prepare(`DELETE FROM locked_accounts WHERE email = ?`).run(email);
}

// ─── סשנים (מנהל בלבד) ───────────────────────────────────────────────────────
function createSession({ email }) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, role, email, display_name, expires_at) VALUES (?, 'admin', ?, 'מנהל', ?)`)
    .run(token, email, expires);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token);
  if (!row) return null;
  if (new Date(row.expires_at) <= new Date()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }
  return row;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// שם העובד מגיע ב-header (נשמר בדפדפן בלבד) - אין אימות, רק תיוג "נוסף על ידי"
function headerName(req) {
  try {
    const raw = req.headers['x-user-name'] ? decodeURIComponent(String(req.headers['x-user-name'])) : '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 40);
  } catch { return ''; }
}

// כל בקשה: אם יש סשן מנהל תקף - req.user הוא המנהל; אחרת עובד אנונימי (עם שם אופציונלי)
function identify(req, _res, next) {
  const session = getSession(bearer(req));
  if (session) req.user = { ...session, is_admin: true };
  else req.user = { role: 'employee', display_name: headerName(req) || null, is_admin: false };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ ok: false, error: 'פעולה זו דורשת התחברות מנהל (בעמוד ההגדרות)' });
  next();
}

// אף אחד לא מזדהה בשם - אין תיוג "נוסף על ידי" לפריטים, גם לא למנהל (הוחלט 2026-10-06).
// נשאר רק ללוג הפעולות ולשדה created_by בהיסטוריה.
function userLabel(user) {
  if (!user) return '';
  return user.is_admin ? 'מנהל' : '';
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/auth/otp/request - שולח קוד למייל המנהל (הכתובת קבועה ב-.env)
router.post('/otp/request', async (req, res) => {
  let email;
  try { email = adminEmail(); } catch (e) { return res.status(e.status || 500).json({ ok: false, error: e.message }); }

  const lock = isLocked(email);
  if (lock) {
    const mins = Math.ceil((new Date(lock.locked_until) - Date.now()) / 60000);
    return res.status(423).json({ ok: false, error: `החשבון נעול זמנית אחרי ניסיונות כושלים. נסה שוב בעוד ${mins} דקות` });
  }

  const code = generateOtp();
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();
  db.prepare(`UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0`).run(email);
  db.prepare(`INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)`).run(email, code, expires);

  if (process.env.OTP_DEBUG === '1') console.log(`[otp] code for ${email}: ${code}`);

  const siteName = db.getSettings()?.site_name || 'FinitiOnline';
  try {
    await mailer.sendMail({ to: email, subject: `קוד התחברות למנהל - ${siteName}`, html: mailer.otpHtml({ code, siteName }) });
  } catch (err) {
    logger.log({ action: 'otp_send_failed', entity: email, error: err.message, ip: req.ip });
    if (process.env.OTP_DEBUG !== '1') {
      return res.status(502).json({ ok: false, error: 'שליחת קוד ההתחברות נכשלה. בדקו את הגדרות ה-SMTP בשרת' });
    }
  }
  logger.log({ action: 'otp_request', entity: email, ip: req.ip });
  res.json({ ok: true, message: 'קוד התחברות נשלח למייל המנהל', email_hint: maskEmail(email) });
});

// POST /api/auth/otp/verify { code } → token (admin)
router.post('/otp/verify', (req, res) => {
  let email;
  try { email = adminEmail(); } catch (e) { return res.status(e.status || 500).json({ ok: false, error: e.message }); }
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ ok: false, error: 'יש להזין קוד בן 6 ספרות' });

  const lock = isLocked(email);
  if (lock) return res.status(423).json({ ok: false, error: 'החשבון נעול זמנית. נסה שוב מאוחר יותר' });

  const row = db.prepare(`
    SELECT * FROM otp_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(email, code, new Date().toISOString());
  if (!row) {
    const attempts = recordFailedAttempt(email);
    logger.log({ action: 'otp_verify_failed', entity: email, details: { attempts }, ip: req.ip });
    const left = LOCK_MAX_ATTEMPTS - attempts;
    return res.status(400).json({ ok: false, error: left > 0 ? `קוד שגוי או שפג תוקפו (נותרו ${left} ניסיונות)` : 'החשבון נעול ל-10 דקות' });
  }

  db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);
  clearFailedAttempts(email);
  db.prepare(`
    INSERT INTO users (email, role, last_login) VALUES (?, 'admin', datetime('now'))
    ON CONFLICT(email) DO UPDATE SET last_login = datetime('now')
  `).run(email);

  const token = createSession({ email });
  logger.log({ user: { email, role: 'admin' }, action: 'admin_login', ip: req.ip });
  res.json({ ok: true, token, email });
});

// GET /api/auth/me - האם הטוקן שבדפדפן עדיין מנהל תקף
router.get('/me', identify, (req, res) => {
  res.json({ ok: true, is_admin: !!req.user.is_admin, email: req.user.email || null });
});

router.post('/logout', identify, (req, res) => {
  if (req.user.is_admin) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.user.token);
  res.json({ ok: true });
});

function maskEmail(e) {
  const [u, d] = e.split('@');
  if (!d) return e;
  return `${u.slice(0, 2)}***@${d}`;
}

module.exports = { router, identify, requireAdmin, userLabel, adminEmail: () => ADMIN_EMAIL };
