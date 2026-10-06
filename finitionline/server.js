// FinitiOnline - רשימת קניות משותפת של המשרד
// Express על פורט ייעודי (3040), מוגש מאחורי nginx תחת planner.dolcemaster.co.il/finitionline
// העמוד פתוח לכל עובדי החברה (רשת פנימית). רק פעולות ניהול דורשות מנהל (OTP).
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const logger = require('./logger');
const mailer = require('./mailer');
const scheduler = require('./scheduler');
const { router: authRouter, identify, requireAdmin, userLabel, adminEmail } = require('./auth');

const PORT = Number(process.env.PORT) || 3040;
const HOST = process.env.HOST || '127.0.0.1';
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PKG_VERSION = require('./package.json').version;
const SITE_DEFAULT = 'FinitiOnline';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));

const r = express.Router();
r.use(identify);   // כל בקשה מקבלת req.user: מנהל (סשן) או עובד אנונימי (שם מ-header)

// ─── עזרים ──────────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

function settingsPublic() {
  const s = db.getSettings();
  return {
    site_name: s?.site_name || process.env.SITE_NAME || SITE_DEFAULT,
    logo_url: s?.logo_url || null,
    list_name: s?.list_name || null,
  };
}

function recipientsFor(s) {
  const configured = mailer.parseRecipients(s?.recipients || '');
  if (configured.length) return configured;
  const admin = adminEmail();
  return admin ? [admin] : [];
}

function listItems() {
  return db.prepare(`
    SELECT id, name, qty, note, checked, added_by, created_at, updated_at, sort_order
      FROM list_items ORDER BY checked ASC, sort_order ASC, id ASC
  `).all();
}

function snapshotItems() {
  return listItems().map(i => ({ name: i.name, qty: i.qty, note: i.note || '', added_by: i.added_by || '', checked: !!i.checked }));
}

function parseQty(v, fallback = 1) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function cleanName(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function cleanNote(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return s || null;
}

function israelDateStr() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date()).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.day}/${p.month}/${p.year}`;
}

// הוספת פריט: שם קיים (לא מסומן) מעלה כמות במקום לשכפל
const addItemTx = db.transaction(({ name, qty, note, addedBy }) => {
  const norm = db.normName(name);
  const existing = db.prepare(`SELECT * FROM list_items WHERE name_norm = ? AND checked = 0 LIMIT 1`).get(norm);
  let item;
  if (existing) {
    db.prepare(`UPDATE list_items SET qty = qty + ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?`)
      .run(qty, note, nowIso(), existing.id);
    item = db.prepare(`SELECT * FROM list_items WHERE id = ?`).get(existing.id);
    item.merged = true;
  } else {
    const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM list_items`).get().m;
    const info = db.prepare(`
      INSERT INTO list_items (name, name_norm, qty, note, added_by, created_at, updated_at, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, norm, qty, note, addedBy, nowIso(), nowIso(), maxOrder + 1);
    item = db.prepare(`SELECT * FROM list_items WHERE id = ?`).get(info.lastInsertRowid);
    item.merged = false;
  }
  db.touchCatalog(name);
  db.bumpVersion();
  return item;
});

// שמירה להיסטוריה + שליחה במייל. משמש את "סגור רשימה", "שלח עכשיו" והשליחה השבועית.
async function saveAndSend({ source, createdBy, clear = false, items = null }) {
  const s = db.getSettings() || {};
  const payload = items || snapshotItems();
  if (!payload.length) return { ok: false, reason: 'empty' };
  const recipients = recipientsFor(s);
  if (!recipients.length) return { ok: false, reason: 'no_recipient' };

  const info = db.prepare(`
    INSERT INTO orders (created_at, items_count, payload, source, created_by, sent_to)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nowIso(), payload.length, JSON.stringify(payload), source, createdBy || null, recipients.join(', '));
  const orderId = Number(info.lastInsertRowid);

  const siteName = s.site_name || SITE_DEFAULT;
  const sourceLabel = { weekly: 'שליחה שבועית אוטומטית', history: 'שליחה חוזרת מההיסטוריה' }[source] || '';
  let sentOk = 1;
  let error = null;
  try {
    await mailer.sendMail({
      to: recipients,
      subject: `רשימת קניות - ${s.list_name || siteName} - ${israelDateStr()}`,
      html: mailer.listHtml({ siteName, listName: s.list_name, items: payload, dateStr: israelDateStr(), sentBy: createdBy, sourceLabel }),
    });
  } catch (err) {
    sentOk = 0;
    error = err.message;
  }
  db.prepare(`UPDATE orders SET sent_at = ?, sent_ok = ? WHERE id = ?`).run(nowIso(), sentOk, orderId);

  if (clear && sentOk) {
    db.prepare(`DELETE FROM list_items`).run();
    db.bumpVersion();
  }
  return { ok: !!sentOk, reason: sentOk ? null : 'send_failed', error, order_id: orderId, recipients, items_count: payload.length, cleared: !!(clear && sentOk) };
}

function respondSend(res, result) {
  if (result.reason === 'empty') return fail(res, 400, 'הרשימה ריקה - אין מה לשלוח');
  if (result.reason === 'no_recipient') return fail(res, 500, 'לא הוגדרה כתובת מייל לשליחה (בהגדרות או FINITIONLINE_ADMIN_EMAIL)');
  if (result.reason === 'send_failed') return res.status(502).json({ ok: false, error: `הרשימה נשמרה בהיסטוריה אבל שליחת המייל נכשלה: ${result.error}`, order_id: result.order_id });
  res.json({ ok: true, order_id: result.order_id, recipients: result.recipients, items_count: result.items_count, cleared: result.cleared, version: db.getVersion() });
}

// ─── Auth (מנהל בלבד) ───────────────────────────────────────────────────────
r.use('/api/auth', authRouter);

r.get('/api/version', (_req, res) => res.json({ ok: true, version: PKG_VERSION, name: 'FinitiOnline' }));
r.get('/api/health', (_req, res) => res.json({ ok: true, version: PKG_VERSION, time: nowIso() }));

// ─── הגדרות ─────────────────────────────────────────────────────────────────
r.get('/api/settings', (req, res) => {
  const pub = settingsPublic();
  pub.is_admin = !!req.user.is_admin;
  if (req.user.is_admin) {
    const s = db.getSettings();
    pub.recipients = s?.recipients || '';
    pub.admin_email = adminEmail();
    pub.smtp_config_found = !!mailer.getSmtpConfig()._path;
  }
  res.json({ ok: true, ...pub });
});

r.put('/api/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  const siteName = cleanName(b.site_name) || SITE_DEFAULT;
  const listName = cleanName(b.list_name).slice(0, 40) || null;
  const recipients = mailer.parseRecipients(b.recipients || '');
  const rawRecipients = String(b.recipients || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
  if (rawRecipients.length !== recipients.length) return fail(res, 400, 'אחת מכתובות המייל אינה תקינה');

  db.prepare(`
    INSERT INTO settings (id, site_name, list_name, recipients, setup_completed, updated_at)
    VALUES (1, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      site_name = excluded.site_name, list_name = excluded.list_name,
      recipients = excluded.recipients, setup_completed = 1, updated_at = excluded.updated_at
  `).run(siteName, listName, recipients.join(', ') || null, nowIso());
  logger.log({ user: req.user, action: 'settings_update', details: { siteName, listName, recipients: recipients.length }, ip: req.ip });
  res.json({ ok: true, ...settingsPublic() });
});

// לוגו כ-data URL (עד 2MB) - נשמר ב-DB, לא בקבצים, כדי לשרוד פריסות
r.post('/api/settings/logo', requireAdmin, (req, res) => {
  const dataUrl = String(req.body?.data_url || '');
  const m = /^data:(image\/(png|jpeg|jpg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return fail(res, 400, 'הקובץ שנבחר אינו תמונה תקינה');
  const bytes = Math.floor(m[3].length * 3 / 4);
  if (bytes > LOGO_MAX_BYTES) return fail(res, 400, 'גודל הלוגו חורג מ-2MB');
  db.prepare(`INSERT INTO settings (id, logo_url, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET logo_url = excluded.logo_url, updated_at = excluded.updated_at`)
    .run(dataUrl, nowIso());
  logger.log({ user: req.user, action: 'logo_update', details: { bytes }, ip: req.ip });
  res.json({ ok: true, logo_url: dataUrl });
});

r.delete('/api/settings/logo', requireAdmin, (req, res) => {
  db.prepare(`UPDATE settings SET logo_url = NULL, updated_at = ? WHERE id = 1`).run(nowIso());
  res.json({ ok: true });
});

r.post('/api/email/test', requireAdmin, async (req, res) => {
  const to = mailer.parseRecipients(req.body?.to || adminEmail());
  if (!to.length) return fail(res, 400, 'כתובת מייל לא תקינה');
  const siteName = db.getSettings()?.site_name || SITE_DEFAULT;
  try {
    await mailer.sendMail({ to, subject: `מייל בדיקה - ${siteName}`, html: mailer.testHtml({ siteName }) });
    res.json({ ok: true, to });
  } catch (err) {
    fail(res, 502, `שליחת המייל נכשלה: ${err.message}`);
  }
});

// ─── הרשימה (פתוח לכל העובדים) ──────────────────────────────────────────────
r.get('/api/list', (_req, res) => {
  res.json({ ok: true, version: db.getVersion(), items: listItems() });
});

r.get('/api/list/version', (_req, res) => {
  res.json({ ok: true, version: db.getVersion() });
});

r.post('/api/list/items', (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return fail(res, 400, 'יש להקליד שם מוצר');
  const qty = parseQty(req.body?.qty, 1);
  if (qty === null || qty === 0) return fail(res, 400, 'כמות לא תקינה');
  const note = cleanNote(req.body?.note);
  const item = addItemTx({ name, qty, note, addedBy: null });   // אין תיוג מי הוסיף
  logger.log({ user: req.user, action: item.merged ? 'item_merge' : 'item_add', entity: name, details: { qty }, ip: req.ip });
  res.status(201).json({ ok: true, item, version: db.getVersion() });
});

r.patch('/api/list/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare(`SELECT * FROM list_items WHERE id = ?`).get(id);
  if (!cur) return fail(res, 404, 'הפריט לא נמצא');
  const b = req.body || {};
  const sets = [];
  const args = [];
  if (b.name !== undefined) {
    const name = cleanName(b.name);
    if (!name) return fail(res, 400, 'שם המוצר לא יכול להיות ריק');
    sets.push('name = ?', 'name_norm = ?'); args.push(name, db.normName(name));
    db.touchCatalog(name);
  }
  if (b.qty !== undefined) {
    const qty = parseQty(b.qty, 1);
    if (qty === null) return fail(res, 400, 'כמות לא תקינה');
    if (qty === 0) {
      db.prepare(`DELETE FROM list_items WHERE id = ?`).run(id);
      db.bumpVersion();
      return res.json({ ok: true, deleted: true, version: db.getVersion() });
    }
    sets.push('qty = ?'); args.push(qty);
  }
  if (b.note !== undefined) { sets.push('note = ?'); args.push(cleanNote(b.note)); }
  if (b.checked !== undefined) { sets.push('checked = ?'); args.push(b.checked ? 1 : 0); }
  if (!sets.length) return fail(res, 400, 'אין מה לעדכן');
  sets.push('updated_at = ?'); args.push(nowIso());
  args.push(id);
  db.prepare(`UPDATE list_items SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  db.bumpVersion();
  res.json({ ok: true, item: db.prepare(`SELECT * FROM list_items WHERE id = ?`).get(id), version: db.getVersion() });
});

r.delete('/api/list/items/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM list_items WHERE id = ?`).run(Number(req.params.id));
  if (!info.changes) return fail(res, 404, 'הפריט לא נמצא');
  db.bumpVersion();
  res.json({ ok: true, version: db.getVersion() });
});

r.post('/api/list/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) return fail(res, 400, 'רשימת מזהים ריקה');
  const upd = db.prepare(`UPDATE list_items SET sort_order = ? WHERE id = ?`);
  db.transaction(() => { ids.forEach((id, i) => upd.run(i + 1, id)); db.bumpVersion(); })();
  res.json({ ok: true, version: db.getVersion() });
});

// מסיר את כל הפריטים שסומנו כנקנו
r.delete('/api/list/checked', (req, res) => {
  const info = db.prepare(`DELETE FROM list_items WHERE checked = 1`).run();
  if (info.changes) db.bumpVersion();
  res.json({ ok: true, removed: info.changes, version: db.getVersion() });
});

r.delete('/api/list', requireAdmin, (req, res) => {
  const info = db.prepare(`DELETE FROM list_items`).run();
  db.bumpVersion();
  logger.log({ user: req.user, action: 'list_clear', details: { removed: info.changes }, ip: req.ip });
  res.json({ ok: true, removed: info.changes, version: db.getVersion() });
});

// הקטלוג: כל המוצרים שהוזמנו אי פעם (item_catalog) - ממלא את כרטיסי המוצרים במסך הראשי
r.get('/api/catalog', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const rows = db.prepare(`SELECT display_name AS name, use_count, last_used_at, image FROM item_catalog ORDER BY use_count DESC, last_used_at DESC LIMIT ?`).all(limit);
  res.json({ ok: true, items: rows });
});

// תמונת מוצר (מנהל): data URL שהדפדפן כבר הקטין (עד ~320px), מוגבל ל-400KB
const IMAGE_MAX_BYTES = 400 * 1024;
r.put('/api/catalog/:name/image', requireAdmin, (req, res) => {
  const norm = db.normName(req.params.name);
  const dataUrl = String(req.body?.data_url || '');
  const m = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return fail(res, 400, 'הקובץ שנבחר אינו תמונה תקינה');
  if (Math.floor(m[3].length * 3 / 4) > IMAGE_MAX_BYTES) return fail(res, 400, 'התמונה גדולה מדי (עד 400KB אחרי הקטנה)');
  const info = db.prepare(`UPDATE item_catalog SET image = ? WHERE name_norm = ?`).run(dataUrl, norm);
  if (!info.changes) return fail(res, 404, 'המוצר לא נמצא בקטלוג');
  logger.log({ user: req.user, action: 'catalog_image_set', entity: req.params.name, ip: req.ip });
  res.json({ ok: true });
});

r.delete('/api/catalog/:name/image', requireAdmin, (req, res) => {
  db.prepare(`UPDATE item_catalog SET image = NULL WHERE name_norm = ?`).run(db.normName(req.params.name));
  logger.log({ user: req.user, action: 'catalog_image_clear', entity: req.params.name, ip: req.ip });
  res.json({ ok: true });
});

r.delete('/api/catalog/:name', requireAdmin, (req, res) => {
  const info = db.prepare(`DELETE FROM item_catalog WHERE name_norm = ?`).run(db.normName(req.params.name));
  if (!info.changes) return fail(res, 404, 'המוצר לא נמצא בקטלוג');
  logger.log({ user: req.user, action: 'catalog_delete', entity: req.params.name, ip: req.ip });
  res.json({ ok: true });
});

r.get('/api/suggest', (req, res) => {
  const q = db.normName(req.query.q);
  if (!q) return res.json({ ok: true, results: [] });
  const like = q.replace(/[%_]/g, ch => '\\' + ch);
  const rows = db.prepare(`
    SELECT display_name AS name, use_count FROM item_catalog
     WHERE name_norm LIKE ? ESCAPE '\\' OR name_norm LIKE ? ESCAPE '\\'
     ORDER BY (name_norm LIKE ? ESCAPE '\\') DESC, use_count DESC, last_used_at DESC
     LIMIT 10
  `).all(`${like}%`, `% ${like}%`, `${like}%`);
  res.json({ ok: true, results: rows });
});

// סגירת רשימה (מנהל): שמירה להיסטוריה + מייל + ריקון (אלא אם keep_list)
r.post('/api/list/close', requireAdmin, async (req, res) => {
  const result = await saveAndSend({ source: 'manual', createdBy: userLabel(req.user), clear: req.body?.keep_list ? false : true });
  logger.log({ user: req.user, action: 'list_close', details: result, ip: req.ip });
  return respondSend(res, result);
});

// שליחה מיידית בלי לרוקן (מנהל)
r.post('/api/list/send-now', requireAdmin, async (req, res) => {
  const result = await saveAndSend({ source: 'manual', createdBy: userLabel(req.user), clear: false });
  logger.log({ user: req.user, action: 'list_send_now', details: result, ip: req.ip });
  return respondSend(res, result);
});

// ─── היסטוריה ───────────────────────────────────────────────────────────────
r.get('/api/orders', (_req, res) => {
  const rows = db.prepare(`SELECT id, created_at, items_count, source, created_by, sent_to, sent_at, sent_ok FROM orders ORDER BY id DESC LIMIT 200`).all();
  res.json({ ok: true, orders: rows });
});

r.get('/api/orders/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(Number(req.params.id));
  if (!row) return fail(res, 404, 'הרשימה לא נמצאה');
  row.payload = JSON.parse(row.payload || '[]');
  res.json({ ok: true, order: row });
});

r.post('/api/orders/:id/restore', (req, res) => {
  const row = db.prepare(`SELECT payload FROM orders WHERE id = ?`).get(Number(req.params.id));
  if (!row) return fail(res, 404, 'הרשימה לא נמצאה');
  const items = JSON.parse(row.payload || '[]');
  db.transaction(() => {
    for (const it of items) {
      const name = cleanName(it.name);
      if (!name) continue;
      addItemTx({ name, qty: parseQty(it.qty, 1) || 1, note: cleanNote(it.note), addedBy: null });
    }
  })();
  logger.log({ user: req.user, action: 'order_restore', entity: req.params.id, details: { items: items.length }, ip: req.ip });
  res.json({ ok: true, added: items.length, version: db.getVersion(), items: listItems() });
});

r.post('/api/orders/:id/send', async (req, res) => {
  const row = db.prepare(`SELECT payload FROM orders WHERE id = ?`).get(Number(req.params.id));
  if (!row) return fail(res, 404, 'הרשימה לא נמצאה');
  const result = await saveAndSend({ source: 'history', createdBy: userLabel(req.user), clear: false, items: JSON.parse(row.payload || '[]') });
  logger.log({ user: req.user, action: 'order_resend', entity: req.params.id, details: result, ip: req.ip });
  return respondSend(res, result);
});

r.delete('/api/orders/:id', requireAdmin, (req, res) => {
  const info = db.prepare(`DELETE FROM orders WHERE id = ?`).run(Number(req.params.id));
  if (!info.changes) return fail(res, 404, 'הרשימה לא נמצאה');
  logger.log({ user: req.user, action: 'order_delete', entity: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

// ─── סטטיק ──────────────────────────────────────────────────────────────────
const NO_CACHE = { 'Cache-Control': 'no-cache' };
r.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'), { headers: NO_CACHE }));
r.use(express.static(PUBLIC_DIR, { index: false, setHeaders: res => res.set(NO_CACHE) }));

// כל נתיב אחר תחת BASE_PATH - 404 מפורש (לא נופל לסטטיק של Planner)
r.use((req, res) => {
  if (req.path.startsWith('/api/')) return fail(res, 404, 'not found');
  res.status(404).type('text/plain').send('Not found');
});

// ─── חיבור תחת BASE_PATH ────────────────────────────────────────────────────
if (BASE_PATH) {
  // /finitionline (בלי slash) → /finitionline/ . השוואה מדויקת על req.path, כי
  // app.get(BASE_PATH) ב-Express תופס גם את הגרסה עם ה-slash ויוצר לולאת הפניות.
  app.use((req, res, next) => {
    if (req.path !== BASE_PATH) return next();
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, BASE_PATH + '/' + qs);
  });
  app.use(BASE_PATH, r);
  app.use((_req, res) => res.redirect(302, BASE_PATH + '/'));
} else {
  app.use(r);
}

app.use((err, req, res, _next) => {
  if (err?.type === 'entity.too.large') return fail(res, 413, 'הבקשה גדולה מדי');
  if (err?.type === 'entity.parse.failed') return fail(res, 400, 'JSON לא תקין');
  logger.logError({ error: err, path: req.path, method: req.method, user: req.user, ip: req.ip });
  console.error(err);
  fail(res, 500, 'server_error');
});

// ─── Start ──────────────────────────────────────────────────────────────────
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
app.listen(PORT, HOST, () => {
  console.log(`FinitiOnline v${PKG_VERSION} running on http://${HOST}:${PORT}${BASE_PATH}/  (db: ${db.DB_PATH})`);
  if (!adminEmail()) console.warn('[auth] אזהרה: FINITIONLINE_ADMIN_EMAIL לא מוגדר - התחברות מנהל לא תעבוד');
  const smtp = mailer.getSmtpConfig();
  console.log(`[smtp] config: ${smtp._path || 'ברירת מחדל (לא נמצא smtp-config.json)'}`);
  scheduler.start(({ source, createdBy }) => saveAndSend({ source, createdBy, clear: false }));
});
