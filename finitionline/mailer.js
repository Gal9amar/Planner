// FinitiOnline - שליחת מיילים ב-SMTP הפנימי (dc1) דרך send_mail.py + תבניות HTML
//
// הגדרות SMTP: finitionline/data/smtp-config.json אם קיים, אחרת הקובץ של Planner
// (../data/smtp-config.json - כבר קיים בשרת). שם השולח תמיד "FinitiOnline".
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const SMTP_SCRIPT = path.join(__dirname, 'send_mail.py');
const CONFIG_CANDIDATES = [
  path.join(__dirname, 'data', 'smtp-config.json'),
  path.join(__dirname, '..', 'data', 'smtp-config.json'),
];
const FROM_NAME = 'FinitiOnline';

function getSmtpConfig() {
  for (const p of CONFIG_CANDIDATES) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { ...cfg, _path: p };
    } catch {}
  }
  return { host: 'dc1.dolcemaster.co.il', port: 25, fromEmail: 'gal@finitione.com', _path: null };
}

function parseRecipients(to) {
  const list = Array.isArray(to) ? to : String(to || '').split(/[,;]/);
  return [...new Set(list.map(a => a.trim().toLowerCase()).filter(a => a && a.includes('@')))];
}

function sendMail({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const toEmails = parseRecipients(to);
    if (!toEmails.length) return reject(new Error('no recipients'));
    // TEST_MODE=1 (בדיקות מקומיות): לא שולחים שום מייל - לא למנהל ולא לכתובות בדיקה.
    // המכונה המקומית כן מגיעה ל-dc1, אז בלי זה כל בדיקת OTP/סגירה שולחת מייל אמיתי.
    if (process.env.TEST_MODE === '1') {
      console.log(`[smtp] TEST_MODE - לא נשלח: "${subject}" → ${toEmails.join(', ')}`);
      return resolve(toEmails);
    }
    const smtp = getSmtpConfig();
    const payload = JSON.stringify({
      smtp_host: smtp.host,
      smtp_port: smtp.port || 25,
      from_email: smtp.fromEmail || 'gal@finitione.com',
      from_name: FROM_NAME,
      to_emails: toEmails,
      subject,
      body_html: html,
      smtp_user: smtp.user || '',
      smtp_password: smtp.password || '',
    });
    console.log(`[smtp] sending "${subject}" to ${toEmails.join(', ')} via ${smtp.host}:${smtp.port || 25}`);
    const pyBin = process.platform === 'win32' ? 'python' : 'python3';
    const proc = execFile(pyBin, [SMTP_SCRIPT], { timeout: 30000, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        console.error('[smtp] FAILED:', (stderr || err.message).trim());
        return reject(new Error((stderr || err.message).trim()));
      }
      console.log(`[smtp] sent (${stdout.trim()})`);
      resolve(toEmails);
    });
    proc.stdin.write(payload, 'utf8');
    proc.stdin.end();
  });
}

// ─── תבניות ──────────────────────────────────────────────────────────────────
// מגבלות לקוחות מייל (Gmail/Outlook): בלי gradient, בלי Google Fonts,
// border-radius רק על td, הכל inline.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const BRAND = '#17418f';
const ACCENT = '#2ea3dd';

function shell(siteName, bodyHtml) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f7fb;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f7fb;padding:32px 12px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background-color:${BRAND};padding:18px 24px;border-radius:12px 12px 0 0;text-align:right">
    <span style="color:${ACCENT};font-size:22px;font-weight:bold;font-family:'Arial Black',Arial,sans-serif" dir="ltr">Finiti<span style="color:#ffffff"><span style="color:#e3342f">O</span>nline</span></span>
    ${siteName && siteName !== 'FinitiOnline' ? `<span style="color:#dbe7f7;font-size:14px;margin-right:12px">· ${esc(siteName)}</span>` : ''}
  </td></tr>
  <tr><td style="background-color:#ffffff;padding:24px;border:1px solid #e2e9f2;border-top:0;border-radius:0 0 12px 12px;color:#182338;font-size:15px;line-height:1.6;text-align:right">
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:14px 8px;color:#71809a;font-size:12px;text-align:center">נשלח אוטומטית מ-FinitiOnline</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function otpHtml({ code, siteName }) {
  const appUrl = process.env.APP_URL || '';
  return shell(siteName, `
    <p style="margin:0 0 10px">שלום,</p>
    <p style="margin:0 0 18px">קוד ההתחברות שלך ל-FinitiOnline:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 18px"><tr>
      <td style="background-color:#e9f2fa;border:1px solid #cfe0f3;border-radius:10px;padding:14px 28px;font-size:34px;font-weight:bold;letter-spacing:8px;color:${BRAND};font-family:'Courier New',monospace" dir="ltr">${esc(code)}</td>
    </tr></table>
    <p style="margin:0 0 6px;color:#555">הקוד תקף ל-10 דקות.</p>
    ${appUrl ? `<p style="margin:0 0 6px"><a href="${esc(appUrl)}" style="color:${BRAND}">${esc(appUrl)}</a></p>` : ''}
    <p style="margin:14px 0 0;color:#999;font-size:12px">אם לא ביקשת קוד זה, אפשר להתעלם מההודעה.</p>
  `);
}

function listHtml({ siteName, listName, items, dateStr, sentBy, sourceLabel }) {
  const td = 'padding:8px 12px;border:1px solid #d0d7e2;font-size:14px;color:#182338;text-align:right;vertical-align:top';
  const th = `padding:9px 12px;border:1px solid ${BRAND};background-color:${BRAND};color:#ffffff;font-size:14px;font-weight:bold;text-align:right`;
  const row = (it, i) => `
    <tr${i % 2 ? ' style="background-color:#f2f6fc"' : ''}>
      <td style="${td}">${esc(it.name)}</td>
      <td style="${td};text-align:center;white-space:nowrap">${esc(fmtQty(it.qty))}</td>
      <td style="${td};color:#555">${esc(it.note || '')}</td>
    </tr>`;
  const rows = items.map(row).join('');
  return shell(siteName, `
    <p style="margin:0 0 6px">שלום,</p>
    <p style="margin:0 0 16px">רשימת הקניות <b>${esc(listName || siteName || 'של המשרד')}</b> מתאריך ${esc(dateStr)}${sentBy ? `, נשלחה על ידי ${esc(sentBy)}` : ''}${sourceLabel ? ` (${esc(sourceLabel)})` : ''}:</p>
    <table dir="rtl" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
      <tr>
        <th style="${th}">מוצר</th>
        <th style="${th};text-align:center">כמות</th>
        <th style="${th}">הערה</th>
      </tr>
      ${rows}
      <tr><td colspan="3" style="${td};background-color:#e8eef9;font-weight:bold">סה"כ ${items.length} פריטים</td></tr>
    </table>
  `);
}

function testHtml({ siteName }) {
  return shell(siteName, `
    <p style="margin:0 0 8px">זהו מייל בדיקה מ-FinitiOnline.</p>
    <p style="margin:0;color:#555">אם ההודעה הגיעה, הגדרות ה-SMTP תקינות.</p>
  `);
}

function fmtQty(q) {
  const n = Number(q);
  if (!isFinite(n)) return '1';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

module.exports = { sendMail, getSmtpConfig, parseRecipients, otpHtml, listHtml, testHtml, FROM_NAME };
