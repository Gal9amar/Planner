const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { execFile } = require('child_process');
const path       = require('path');
const fs         = require('fs');
const db         = require('./db');
const logger     = require('./logger');

// ── SMTP (via Python — same method as Ratchet) ────────────────────────────────
const SMTP_SCRIPT     = path.join(__dirname, 'send_mail.py');
const SMTP_CONFIG_PATH = path.join(__dirname, 'data', 'smtp-config.json');

function getSmtpConfig() {
  try {
    return JSON.parse(fs.readFileSync(SMTP_CONFIG_PATH, 'utf8'));
  } catch {
    return { host: 'localhost', port: 25, fromEmail: 'planner@finitione.com', fromName: 'Planner' };
  }
}

function sendMail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const smtp = getSmtpConfig();
    const fromName  = smtp.fromName  || 'Planner';
    const fromEmail = smtp.fromEmail || 'planner@finitione.com';
    const payload = JSON.stringify({
      smtp_host:  smtp.host,
      smtp_port:  smtp.port || 25,
      from_email: `${fromName} <${fromEmail}>`,
      to_email:   to,
      subject,
      body_html:  html,
    });
    console.log(`[smtp] sending to ${to} via ${smtp.host}:${smtp.port || 25} ...`);
    const pyBin = process.platform === 'win32' ? 'python' : 'python3';
    const proc = execFile(pyBin, [SMTP_SCRIPT], { timeout: 20000, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        console.error('[smtp] ✗ FAILED:', stderr || err.message);
        return reject(new Error(stderr || err.message));
      }
      console.log(`[smtp] ✓ email sent to ${to} — python response: ${stdout.trim()}`);
      resolve();
    });
    proc.stdin.write(payload, 'utf8');
    proc.stdin.end();
  });
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(email, otp) {
  const loginUrl = process.env.APP_URL || 'https://qa.dolcemaster.co.il/workgant/';
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#e8eaf0;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8eaf0;padding:40px 16px">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">

      <!-- Header -->
      <tr>
        <td style="background:#1e293b;padding:32px 40px;text-align:center">
          <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:2px;text-transform:uppercase">PLANNER</p>
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:0.5px">קוד כניסה חד-פעמי</h1>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="background:#ffffff;padding:40px 40px 32px">

          <p style="margin:0 0 6px;color:#0f172a;font-size:16px;font-weight:700">שלום,</p>
          <p style="margin:0 0 32px;color:#475569;font-size:15px;line-height:1.7">
            קוד הכניסה שלך למערכת <strong style="color:#0f172a">Planner</strong> הוא:
          </p>

          <!-- OTP box — table-based for email clients -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
            <tr>
              <td align="center">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:#1e293b;border-radius:12px;padding:20px 40px;text-align:center">
                      <p style="margin:0;font-family:Courier New,Courier,monospace;font-size:40px;font-weight:700;color:#ffffff;letter-spacing:12px;line-height:1">${otp}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Warning box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px">
            <tr>
              <td style="background:#fffbeb;border:1px solid #f59e0b;border-radius:10px;padding:14px 20px;text-align:center">
                <p style="margin:0;color:#78350f;font-size:13px;font-weight:600;line-height:1.6">
                  הקוד תקף ל-<strong>5 דקות</strong> בלבד ולשימוש חד-פעמי
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;text-align:center">
            אם לא ביקשת קוד זה — ניתן להתעלם מהמייל הזה.
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center">
          <p style="margin:0;color:#94a3b8;font-size:12px">
            Planner &nbsp;&middot;&nbsp; <a href="${loginUrl}" style="color:#6366f1;text-decoration:none">planner.dolcemaster.co.il/workgant</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  try {
    await sendMail({ to: email, subject: 'סיסמת התחברות למערכת Planner', html });
  } catch (e) {
    console.error(`[smtp] ✗ FAILED to send OTP to ${email}:`, e.message);
    throw e;
  }
}

const LOCK_MAX_ATTEMPTS = 3;
const LOCK_DURATION_MIN = 10;

function isAccountLocked(email) {
  const row = db.prepare(`SELECT * FROM locked_accounts WHERE email=? COLLATE NOCASE`).get(email);
  if (!row) return null;
  if (new Date(row.locked_until) > new Date()) return row;
  // Lock expired — remove it
  db.prepare(`DELETE FROM locked_accounts WHERE email=? COLLATE NOCASE`).run(email);
  return null;
}

function recordFailedAttempt(email) {
  const existing = db.prepare(`SELECT * FROM locked_accounts WHERE email=? COLLATE NOCASE`).get(email);
  const attempts = (existing?.attempts || 0) + 1;
  // נועל רק כשהגיע למקסימום — עד אז locked_until בעבר (לא נחסם)
  const shouldLock = attempts >= LOCK_MAX_ATTEMPTS;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + LOCK_DURATION_MIN * 60 * 1000).toISOString()
    : new Date(0).toISOString(); // עבר — לא נחסם

  if (existing) {
    db.prepare(`UPDATE locked_accounts SET attempts=?, locked_until=?, locked_at=datetime('now'), unlocked_by=NULL, unlocked_at=NULL WHERE email=? COLLATE NOCASE`)
      .run(attempts, lockedUntil, email);
  } else {
    db.prepare(`INSERT INTO locked_accounts (email, attempts, locked_until) VALUES (?,?,?)`)
      .run(email, attempts, lockedUntil);
  }
  return attempts;
}

function clearFailedAttempts(email) {
  db.prepare(`DELETE FROM locked_accounts WHERE email=? COLLATE NOCASE`).run(email);
}

async function sendWelcomeEmail(email, password, role) {
  console.log(`[smtp] sendWelcomeEmail called → to: ${email}, role: ${role}`);
  const loginUrl = process.env.APP_URL || 'https://qa.dolcemaster.co.il/workgant/';
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F2F8;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F8;padding:40px 0">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">

      <!-- Header -->
      <tr>
        <td style="background-color:#1e293b;border-radius:16px 16px 0 0;padding:36px 40px;text-align:center">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px">
            ברוכים הבאים ל-Planner
          </h1>
          <p style="margin:8px 0 0;color:#94a3b8;font-size:14px">מערכת ניהול גאנטים</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="background:#ffffff;padding:36px 40px">
          <p style="margin:0 0 20px;color:#1e293b;font-size:16px;font-weight:600">שלום,</p>
          <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.7">
            החשבון שלך במערכת Planner נוצר בהצלחה. להלן פרטי הכניסה שלך:
          </p>

          <!-- Credentials box -->
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="background:#F1F5F9;border:1px solid #CBD5E1;border-radius:12px;margin-bottom:28px">
            <tr>
              <td style="padding:24px 28px">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:8px 0;color:#475569;font-size:13px;width:80px">אימייל</td>
                    <td style="padding:8px 0;color:#0F172A;font-size:14px;font-weight:600;direction:ltr;text-align:right">${email}</td>
                  </tr>
                  <tr>
                    <td colspan="2" style="border-top:1px solid #CBD5E1"></td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#475569;font-size:13px">סיסמה</td>
                    <td style="padding:8px 0;text-align:right">
                      <span style="background:#0F172A;color:#F8FAFC;font-family:monospace;font-size:15px;font-weight:700;letter-spacing:2px;padding:6px 16px;border-radius:6px;display:inline-block">${password}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
            <tr>
              <td align="center">
                <a href="${loginUrl}"
                   style="display:inline-block;background-color:#6366f1;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:10px;letter-spacing:0.5px">
                  כניסה למערכת Planner ←
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:#64748B;font-size:13px;line-height:1.6">
            לשאלות ובעיות — פנה למנהל המערכת.
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center">
          <p style="margin:0;color:#94A3B8;font-size:12px">
            Planner &nbsp;·&nbsp; planner.dolcemaster.co.il/workgant
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  try {
    await sendMail({ to: email, subject: 'ברוכים הבאים ל-Planner — פרטי כניסה', html });
  } catch (e) {
    console.error(`[smtp] ✗ FAILED to send to ${email}:`, e.message);
  }
}

const router     = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'wg-secret-change-me';
const JWT_EXPIRES = '7d';

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function signReportToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '48h' });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  // support ?token= for SSE (EventSource doesn't support custom headers)
  const token  = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'token_expired' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' });
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'superadmin') return res.status(403).json({ error: 'forbidden' });
  next();
}

// editor OR admin OR superadmin
function requireEditor(req, res, next) {
  const r = req.user?.role;
  if (r !== 'editor' && r !== 'admin' && r !== 'superadmin') return res.status(403).json({ error: 'forbidden' });
  next();
}

// POST /auth/otp/request  — שלב 1: בקש קוד OTP
router.post('/otp/request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'missing_email', message: 'יש להזין כתובת מייל' });

  // בדיקת נעילה
  const lock = isAccountLocked(email);
  if (lock) {
    const remaining = Math.ceil((new Date(lock.locked_until) - Date.now()) / 60000);
    return res.status(429).json({ error: 'account_locked', message: `החשבון נעול. נסה שוב בעוד ${remaining} דקות.`, remaining_minutes: remaining });
  }

  // וידוא משתמש קיים ופעיל — תמיד מחזירים הצלחה (לא מגלים אם מייל קיים)
  const user = db.prepare(`SELECT * FROM users WHERE email=? COLLATE NOCASE AND is_active=1`).get(email);

  if (user) {
    // בטל קודים ישנים
    db.prepare(`UPDATE otp_codes SET used=1 WHERE email=? COLLATE NOCASE AND used=0`).run(email);

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO otp_codes (email, code, expires_at) VALUES (?,?,?)`).run(email, otp, expiresAt);

    if (!process.env.TEST_MODE) {
      try {
        await sendOtpEmail(email, otp);
      } catch (e) {
        console.error('[otp] send failed:', e.message);
        return res.status(500).json({ error: 'send_failed', message: 'שגיאה בשליחת המייל' });
      }
    }
  }

  // תמיד מחזירים הצלחה — לא חושפים אם מייל קיים
  res.json({ ok: true });
});

// POST /auth/otp/verify  — שלב 2: אמת קוד OTP
router.post('/otp/verify', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'missing fields' });

  // בדיקת נעילה
  const lock = isAccountLocked(email);
  if (lock) {
    const remaining = Math.ceil((new Date(lock.locked_until) - Date.now()) / 60000);
    return res.status(429).json({ error: 'account_locked', message: `החשבון נעול. נסה שוב בעוד ${remaining} דקות.`, remaining_minutes: remaining });
  }

  // מצא קוד תקף
  const otpRow = db.prepare(
    `SELECT * FROM otp_codes WHERE email=? COLLATE NOCASE AND used=0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`
  ).get(email);

  if (!otpRow || otpRow.code !== String(code).trim()) {
    const attempts = recordFailedAttempt(email);
    const left = LOCK_MAX_ATTEMPTS - attempts;
    if (left <= 0) {
      return res.status(429).json({ error: 'account_locked', message: `הגעת ל-${LOCK_MAX_ATTEMPTS} ניסיונות כושלים. החשבון ננעל ל-${LOCK_DURATION_MIN} דקות.` });
    }
    return res.status(401).json({ error: 'invalid_otp', message: `קוד שגוי. נותרו ${left} ניסיונות.` });
  }

  // סמן קוד כמשומש
  db.prepare(`UPDATE otp_codes SET used=1 WHERE id=?`).run(otpRow.id);

  const user = db.prepare(`SELECT * FROM users WHERE email=? COLLATE NOCASE AND is_active=1`).get(email);
  if (!user) return res.status(401).json({ error: 'invalid_credentials', message: 'משתמש לא קיים' });

  clearFailedAttempts(email);
  db.prepare(`UPDATE users SET last_login=datetime('now') WHERE id=?`).run(user.id);
  res.json({ token: signToken(user), user: { id: user.id, email: user.email, role: user.role } });
});

// POST /auth/login  — נשמר לתאימות עם resend-welcome ועדכון סיסמה פנימי
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'missing fields' });

  const user = db.prepare(`SELECT * FROM users WHERE email=? COLLATE NOCASE AND is_active=1`).get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'invalid_credentials', message: 'מייל או סיסמה שגויים' });

  db.prepare(`UPDATE users SET last_login=datetime('now') WHERE id=?`).run(user.id);
  res.json({ token: signToken(user), user: { id: user.id, email: user.email, role: user.role } });
});

// POST /auth/logout  (client just discards the token)
router.post('/logout', (_req, res) => res.json({ ok: true }));

// GET /auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(`SELECT id, email, role FROM users WHERE id=?`).get(req.user.sub);
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(user);
});

// POST /auth/change-password  (any authenticated user — for their own password)
router.post('/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing fields' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'too_short', message: 'סיסמה חייבת להכיל לפחות 6 תווים' });

  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.sub);
  if (!bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'wrong_password', message: 'הסיסמה הנוכחית שגויה' });

  db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(bcrypt.hashSync(newPassword, 10), user.id);
  res.json({ ok: true });
});

// ── User management (admin only) ──────────────────────────────────────────────

// helper: get admin's own gantt/category permissions (used to constrain what admin can assign)
function getAdminPermissions(adminId) {
  const gantt_ids    = db.prepare(`SELECT gantt_id FROM user_gantt_permissions WHERE user_id=?`).all(adminId).map(r => r.gantt_id);
  const category_ids = db.prepare(`SELECT category_id FROM user_category_permissions WHERE user_id=?`).all(adminId).map(r => r.category_id);
  return { gantt_ids, category_ids };
}

// helper: clamp permission arrays to what the acting admin is allowed to assign
function clampToAdminPerms(adminId, gantt_ids, category_ids) {
  const mine = getAdminPermissions(adminId);
  return {
    gantt_ids:    (gantt_ids    || []).filter(id => mine.gantt_ids.includes(id)),
    category_ids: (category_ids || []).filter(id => mine.category_ids.includes(id)),
  };
}

// GET /auth/users
router.get('/users', authenticate, requireAdmin, (req, res) => {
  const isSuperAdmin = req.user.role === 'superadmin';

  // admin רואה רק משתמשים שהוא יצר; superadmin רואה הכל
  const users = isSuperAdmin
    ? db.prepare(`SELECT id, email, role, is_active, created_at, last_login, created_by FROM users ORDER BY created_at`).all()
    : db.prepare(`SELECT id, email, role, is_active, created_at, last_login, created_by FROM users WHERE created_by=? ORDER BY created_at`).all(req.user.sub);

  const ganttPerms  = db.prepare(`SELECT user_id, gantt_id FROM user_gantt_permissions`).all();
  const catPerms    = db.prepare(`SELECT user_id, category_id FROM user_category_permissions`).all();
  const allAccessIds = new Set(db.prepare(`SELECT user_id FROM user_all_access`).all().map(r => r.user_id));
  const creatorIds  = [...new Set(users.map(u => u.created_by).filter(Boolean))];
  const creators    = creatorIds.length
    ? db.prepare(`SELECT id, email FROM users WHERE id IN (${creatorIds.map(() => '?').join(',')})`).all(...creatorIds)
    : [];
  const result = users.map(u => ({
    ...u,
    gantt_ids:        ganttPerms.filter(p => p.user_id === u.id).map(p => p.gantt_id),
    category_ids:     catPerms.filter(p => p.user_id === u.id).map(p => p.category_id),
    all_access:       allAccessIds.has(u.id),
    created_by_email: creators.find(c => c.id === u.created_by)?.email || null,
  }));
  res.json(result);
});

// POST /auth/users  — create user
router.post('/users', authenticate, requireAdmin, (req, res) => {
  const { email, role, gantt_ids, category_ids, all_access } = req.body;
  if (!email) return res.status(400).json({ error: 'missing fields', message: 'יש למלא מייל' });

  const isSuperAdmin = req.user.role === 'superadmin';

  // admin יכול ליצור רק viewer/editor; superadmin יכול גם admin
  const allowedRoles = isSuperAdmin ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer'];
  const validRole = allowedRoles.includes(role) ? role : 'viewer';

  // all_access רק superadmin יכול להעניק
  const grantAllAccess = isSuperAdmin && !!all_access;

  // admin — מגביל הרשאות למה שיש לו; superadmin — כל הרשאה תקפה
  const finalPerms = isSuperAdmin
    ? { gantt_ids: gantt_ids || [], category_ids: category_ids || [] }
    : clampToAdminPerms(req.user.sub, gantt_ids, category_ids);

  try {
    const hash = bcrypt.hashSync(Math.random().toString(36).slice(2) + Date.now(), 10);
    const result = db.prepare(`INSERT INTO users (email, password_hash, role, created_by) VALUES (?, ?, ?, ?)`)
      .run(email, hash, validRole, req.user.sub);
    const uid = result.lastInsertRowid;

    if (grantAllAccess) {
      // all_access: הכנס דגל + הרשאות לכל הקטגוריות הקיימות
      db.prepare(`INSERT OR IGNORE INTO user_all_access (user_id) VALUES (?)`).run(uid);
      const allCats = db.prepare(`SELECT id FROM categories WHERE deleted_at IS NULL`).all();
      if (allCats.length) {
        const ins = db.prepare(`INSERT OR IGNORE INTO user_category_permissions (user_id, category_id) VALUES (?, ?)`);
        db.transaction(() => allCats.forEach(c => ins.run(uid, c.id)))();
      }
    } else {
      if (finalPerms.category_ids.length) {
        const ins = db.prepare(`INSERT OR IGNORE INTO user_category_permissions (user_id, category_id) VALUES (?, ?)`);
        db.transaction(() => finalPerms.category_ids.forEach(cid => ins.run(uid, cid)))();
      }
      if (finalPerms.gantt_ids.length) {
        const ins = db.prepare(`INSERT OR IGNORE INTO user_gantt_permissions (user_id, gantt_id) VALUES (?, ?)`);
        db.transaction(() => finalPerms.gantt_ids.forEach(gid => ins.run(uid, gid)))();
      }
    }

    logger.log({ user: req.user, action: 'create_user', entityType: 'user', entityId: uid, entityName: email, ip: req.ip });
    if (!process.env.TEST_MODE) sendWelcomeEmail(email, '(OTP)', validRole);
    res.json({ ok: true, id: uid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'duplicate', message: 'מייל כבר קיים במערכת' });
    throw e;
  }
});

// PATCH /auth/users/:id  — update email / password / role / is_active / gantt_ids / category_ids
router.patch('/users/:id', authenticate, requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  const { email, password, role, is_active, gantt_ids, category_ids, all_access } = req.body;

  const isSuperAdmin = req.user.role === 'superadmin';

  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(uid);
  if (!user) return res.status(404).json({ error: 'not found' });

  // superadmin cannot be edited by admin
  if (user.role === 'superadmin' && !isSuperAdmin)
    return res.status(403).json({ error: 'forbidden', message: 'לא ניתן לערוך מנהל מערכת ראשי' });

  // admin יכול לערוך רק משתמשים שהוא יצר
  if (!isSuperAdmin && user.created_by !== req.user.sub)
    return res.status(403).json({ error: 'forbidden', message: 'אין הרשאה לערוך משתמש זה' });

  const updates = [];
  const params  = [];

  if (email !== undefined) { updates.push('email=?'); params.push(email); }
  if (password !== undefined) {
    if (password.length < 6) return res.status(400).json({ error: 'too_short', message: 'סיסמה חייבת להכיל לפחות 6 תווים' });
    updates.push('password_hash=?');
    params.push(bcrypt.hashSync(password, 10));
  }
  if (role !== undefined) {
    // admin יכול לשנות רק בין viewer/editor; superadmin יכול גם admin
    const allowedRoles = isSuperAdmin ? ['admin', 'editor', 'viewer'] : ['editor', 'viewer'];
    if (allowedRoles.includes(role)) { updates.push('role=?'); params.push(role); }
  }
  if (is_active !== undefined) { updates.push('is_active=?'); params.push(is_active ? 1 : 0); }

  try {
    if (updates.length) {
      params.push(uid);
      db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...params);
    }

    // עדכון הרשאות
    if (isSuperAdmin && all_access === true) {
      // הכל — דגל + כל הקטגוריות הקיימות
      db.prepare(`INSERT OR IGNORE INTO user_all_access (user_id) VALUES (?)`).run(uid);
      db.prepare(`DELETE FROM user_category_permissions WHERE user_id=?`).run(uid);
      db.prepare(`DELETE FROM user_gantt_permissions WHERE user_id=?`).run(uid);
      const allCats = db.prepare(`SELECT id FROM categories WHERE deleted_at IS NULL`).all();
      if (allCats.length) {
        const ins = db.prepare(`INSERT OR IGNORE INTO user_category_permissions (user_id, category_id) VALUES (?, ?)`);
        db.transaction(() => allCats.forEach(c => ins.run(uid, c.id)))();
      }
    } else if (Array.isArray(gantt_ids) || Array.isArray(category_ids)) {
      // עדכון הרשאות ספציפיות — מסיר all_access תמיד
      db.prepare(`DELETE FROM user_all_access WHERE user_id=?`).run(uid);
      db.prepare(`DELETE FROM user_gantt_permissions WHERE user_id=?`).run(uid);
      db.prepare(`DELETE FROM user_category_permissions WHERE user_id=?`).run(uid);

      // admin — מגביל לפי מה שיש לו; superadmin — חופשי
      const finalPerms = isSuperAdmin
        ? { gantt_ids: gantt_ids || [], category_ids: category_ids || [] }
        : clampToAdminPerms(req.user.sub, gantt_ids, category_ids);

      if (finalPerms.category_ids.length) {
        const ins = db.prepare(`INSERT OR IGNORE INTO user_category_permissions (user_id, category_id) VALUES (?, ?)`);
        db.transaction(() => finalPerms.category_ids.forEach(cid => ins.run(uid, cid)))();
      }
      if (finalPerms.gantt_ids.length) {
        const ins = db.prepare(`INSERT OR IGNORE INTO user_gantt_permissions (user_id, gantt_id) VALUES (?, ?)`);
        db.transaction(() => finalPerms.gantt_ids.forEach(gid => ins.run(uid, gid)))();
      }
    }

    logger.log({ user: req.user, action: 'update_user', entityType: 'user', entityId: uid, entityName: user.email, ip: req.ip });

    if (password !== undefined) {
      const updated = db.prepare(`SELECT * FROM users WHERE id=?`).get(uid);
      sendMail({
        to: updated.email,
        subject: 'עדכון סיסמה — Planner',
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;padding:24px;max-width:480px;margin:0 auto;">
          <h2 style="color:#6366f1;">עדכון סיסמה — Planner</h2>
          <p>שלום,</p>
          <p>הסיסמה שלך עודכנה על ידי מנהל המערכת.</p>
          <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin:16px 0;">
            <span style="color:#64748b;font-size:13px;">הסיסמה החדשה שלך:</span><br>
            <span style="font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:#0f172a;">${password}</span>
          </div>
          <p style="color:#94a3b8;font-size:12px;">אם לא ביקשת שינוי זה, פנה למנהל המערכת.</p>
        </div>`
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'duplicate', message: 'מייל כבר קיים במערכת' });
    throw e;
  }
});

// POST /auth/users/:id/resend-welcome
router.post('/users/:id/resend-welcome', authenticate, requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(uid);
  if (!user) return res.status(404).json({ error: 'not found' });

  const tempPass = Array.from({ length: 8 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 55)]).join('');
  db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(require('bcryptjs').hashSync(tempPass, 10), uid);

  sendWelcomeEmail(user.email, tempPass, user.role)
    .then(() => res.json({ ok: true }))
    .catch(e => res.status(500).json({ error: e.message }));
});

// DELETE /auth/users/:id
router.delete('/users/:id', authenticate, requireAdmin, (req, res) => {
  const uid = Number(req.params.id);
  if (uid === req.user.sub) return res.status(400).json({ error: 'cannot_delete_self', message: 'לא ניתן למחוק את עצמך' });

  const target = db.prepare(`SELECT email, role FROM users WHERE id=?`).get(uid);
  if (!target) return res.status(404).json({ error: 'not_found' });

  // admin יכול למחוק רק משתמשים שהוא יצר
  if (req.user.role === 'admin') {
    const owned = db.prepare(`SELECT id FROM users WHERE id=? AND created_by=?`).get(uid, req.user.sub);
    if (!owned) return res.status(403).json({ error: 'forbidden', message: 'אין הרשאה למחוק משתמש זה' });
  }

  // אם מוחקים admin — מסירים הרשאות מכל המשתמשים שהוא יצר
  if (target.role === 'admin') {
    const managed = db.prepare(`SELECT id FROM users WHERE created_by=?`).all(uid);
    if (managed.length) {
      const ids = managed.map(u => u.id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`DELETE FROM user_gantt_permissions WHERE user_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM user_category_permissions WHERE user_id IN (${placeholders})`).run(...ids);
    }
  }

  db.prepare(`DELETE FROM users WHERE id=?`).run(uid);
  logger.log({ user: req.user, action: 'delete_user', entityType: 'user', entityId: uid, entityName: target?.email, ip: req.ip });
  res.json({ ok: true });
});

// PATCH /auth/me  — admin updates their own email/password without providing currentPassword
router.patch('/me', authenticate, requireAdmin, (req, res) => {
  const { email, password } = req.body;
  const updates = [];
  const params  = [];

  if (email !== undefined) {
    updates.push('email=?');
    params.push(email);
  }
  if (password !== undefined) {
    if (password.length < 6) return res.status(400).json({ error: 'too_short', message: 'סיסמה חייבת להכיל לפחות 6 תווים' });
    updates.push('password_hash=?');
    params.push(bcrypt.hashSync(password, 10));
  }

  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });

  try {
    params.push(req.user.sub);
    db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...params);

    // return new token with updated email
    const updated = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.sub);
    res.json({ ok: true, token: signToken(updated), user: { id: updated.id, email: updated.email, role: updated.role } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'duplicate', message: 'מייל כבר קיים במערכת' });
    throw e;
  }
});

// POST /auth/email/test — שליחת מייל בדיקה (superadmin בלבד)
router.post('/email/test', authenticate, requireSuperAdmin, async (req, res) => {
  const { to } = req.body;
  if (!to || !String(to).trim()) return res.status(400).json({ error: 'to_required', message: 'כתובת מייל נדרשת' });
  try {
    await sendMail({
      to: String(to).trim(),
      subject: 'מייל בדיקה — Planner',
      html: `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;padding:24px;max-width:480px;margin:0 auto;"><div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:20px;border-radius:12px 12px 0 0;text-align:center;"><h2 style="color:#fff;margin:0;font-size:20px;">Planner</h2></div><div style="background:#f8fafc;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;"><p style="color:#0f172a;font-size:15px;">זהו מייל בדיקה ממערכת <strong>Planner</strong>.</p><p style="color:#10b981;font-weight:700;font-size:16px;">✅ שירות המייל פועל תקין</p></div></div>`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'send_failed', message: e.message || 'שגיאה בשליחת המייל' });
  }
});

// ── Locked accounts (superadmin only) ────────────────────────────────────────

// GET /auth/locked-accounts
router.get('/locked-accounts', authenticate, requireSuperAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.id as user_db_id
    FROM locked_accounts l
    LEFT JOIN users u ON u.email = l.email COLLATE NOCASE
    WHERE l.locked_until > datetime('now')
    ORDER BY l.locked_at DESC
  `).all();
  res.json(rows.map(r => ({
    ...r,
    remaining_minutes: Math.max(0, Math.ceil((new Date(r.locked_until) - Date.now()) / 60000)),
  })));
});

// DELETE /auth/locked-accounts/:id  — שחרור נעילה מיידי
router.delete('/locked-accounts/:id', authenticate, requireSuperAdmin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`SELECT * FROM locked_accounts WHERE id=?`).get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE locked_accounts SET locked_until=datetime('now'), unlocked_by=?, unlocked_at=datetime('now') WHERE id=?`)
    .run(req.user.sub, id);
  logger.log({ user: req.user, action: 'unlock_account', entityType: 'user', entityName: row.email, ip: req.ip });
  res.json({ ok: true });
});

// ── Logs endpoints (superadmin only) ─────────────────────────────────────────

// GET /auth/logs/dates — list available log file dates
router.get('/logs/dates', authenticate, requireSuperAdmin, (_req, res) => {
  res.json(logger.listLogDates());
});

// GET /auth/logs?date=YYYY-MM-DD&user=&action=&gantt_id=&category_id=
router.get('/logs', authenticate, requireSuperAdmin, (req, res) => {
  const { date, user: userFilter, action: actionFilter, gantt_id, category_id } = req.query;
  const dateStr = date || new Date().toISOString().slice(0, 10);
  let entries = logger.readLogFile(dateStr);

  if (userFilter)    entries = entries.filter(e => (e.user_email || '').toLowerCase().includes(userFilter.toLowerCase()));
  if (actionFilter)  entries = entries.filter(e => (e.action || '').includes(actionFilter));
  if (gantt_id)      entries = entries.filter(e => e.entity_type === 'gantt' && String(e.entity_id) === String(gantt_id));
  if (category_id)   entries = entries.filter(e => e.entity_type === 'category' && String(e.entity_id) === String(category_id));

  res.json(entries);
});

// GET /auth/logs/stream — SSE real-time today's logs
router.get('/logs/stream', authenticate, requireSuperAdmin, logger.sseHandler);

module.exports = { router, authenticate, requireEditor, requireAdmin, sendMail, signReportToken };
