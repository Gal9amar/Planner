/**
 * Planner — Test Suite
 * Usage: node test_suite.js
 *
 * מפעיל שרת עצמאי עם TEST_MODE=1, מריץ בדיקות, מייצא דוח HTML.
 */

const { spawn } = require('child_process');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

// ── הפעלת שרת עם TEST_MODE ────────────────────────────────────────────────────
function killPort(port) {
  return new Promise(resolve => {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32'
      ? `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /F /PID %a`
      : `lsof -ti:${port} | xargs kill -9`;
    exec(cmd, () => setTimeout(resolve, 500));
  });
}

const TEST_PORT = 3021;

function startServer() {
  return new Promise(async (resolve, reject) => {
    await killPort(TEST_PORT);
    const proc = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, TEST_MODE: '1', PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => {
      if (d.toString().includes(String(TEST_PORT)) || d.toString().includes('running')) resolve(proc);
    });
    proc.stderr.on('data', d => process.stderr.write(d));
    proc.on('error', reject);
    setTimeout(() => resolve(proc), 3000);
  });
}

// ── בקשת HTTP ─────────────────────────────────────────────────────────────────
function req(method, reqPath, body, token) {
  return new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ hostname: 'localhost', port: TEST_PORT, path: reqPath, method, headers }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (data) r.write(data); r.end();
  });
}

// ── מעקב תוצאות ──────────────────────────────────────────────────────────────
const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log('\n=== ' + name + ' ===');
}

function ok(action, expected, actual, passed, extra) {
  const result = { section: currentSection, action, expected, actual, passed: !!passed, extra: extra || null };
  results.push(result);
  console.log((passed ? '✅' : '❌') + ' ' + action);
}

// ── התחברות OTP (קורא קוד מ-DB ישירות — ללא מייל) ─────────────────────────────
function otpLogin(email) {
  const db = require('./db');
  return (async () => {
    await req('POST', '/api/auth/otp/request', { email });
    const row = db.prepare(
      `SELECT code FROM otp_codes WHERE email=? COLLATE NOCASE AND used=0 ORDER BY id DESC LIMIT 1`
    ).get(email);
    if (!row) return null;
    const res = await req('POST', '/api/auth/otp/verify', { email, code: row.code });
    return res.status === 200 ? res.body.token : null;
  })();
}

// ── ריצה ראשית ────────────────────────────────────────────────────────────────
async function run() {
  console.log('מפעיל שרת עם TEST_MODE=1...');
  const serverProc = await startServer();
  const startTime = Date.now();

  try {
    const db = require('./db');
    db.prepare(`DELETE FROM users WHERE email LIKE '%@test.com'`).run();

    // ════════════════════════════════════════════════════════════════════════════
    section('אימות — OTP');
    // ════════════════════════════════════════════════════════════════════════════

    const SA = await otpLogin('gal@finitione.com');
    ok(
      'התחברות סופראדמין דרך OTP',
      'קבלת JWT token תקין לאחר אימות קוד OTP',
      SA ? 'token התקבל' : 'לא התקבל token',
      !!SA
    );
    if (!SA) { console.log('ABORT'); serverProc.kill(); process.exit(1); }

    const r1 = await req('POST', '/api/auth/otp/request', {});
    ok(
      'בקשת OTP ללא שדה מייל',
      'שגיאה 400 — שדה מייל חסר',
      `status ${r1.status}`,
      r1.status === 400
    );

    const r2 = await req('POST', '/api/auth/otp/request', { email: 'notexist@test.com' });
    ok(
      'בקשת OTP למייל שאינו קיים במערכת',
      'תגובת 200 (המערכת לא חושפת קיום משתמש)',
      `status ${r2.status}`,
      r2.status === 200
    );

    const r3 = await req('POST', '/api/auth/otp/verify', { email: 'gal@finitione.com', code: '000000' });
    ok(
      'אימות OTP עם קוד שגוי',
      'שגיאה 401 — קוד לא תקין',
      `status ${r3.status}`,
      r3.status === 401
    );

    const r4 = await req('POST', '/api/auth/otp/verify', { email: 'noexist@test.com', code: '000000' });
    ok(
      'אימות OTP למשתמש שאינו קיים',
      'שגיאה 400 או 401',
      `status ${r4.status}`,
      r4.status === 400 || r4.status === 401
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('הכנת נתוני בדיקה');
    // ════════════════════════════════════════════════════════════════════════════

    const TCAT = await req('POST', '/api/categories', { name: 'בורד בדיקות', type: 'annual' }, SA);
    ok(
      'יצירת קטגוריה לצורך הבדיקות',
      'status 200 + id חדש',
      `status ${TCAT.status}, id=${TCAT.body.id}`,
      TCAT.status === 200 && TCAT.body.id
    );
    if (!TCAT.body?.id) { serverProc.kill(); process.exit(1); }
    const catId = TCAT.body.id;

    const TG = await req('POST', '/api/gantts', { category_id: catId, name: 'גאנט בדיקות', type: 'annual', year: 2026 }, SA);
    ok(
      'יצירת גאנט ראשי לצורך הבדיקות',
      'status 200 + id חדש',
      `status ${TG.status}, id=${TG.body.id}`,
      TG.status === 200 && TG.body.id
    );
    if (!TG.body?.id) { serverProc.kill(); process.exit(1); }
    const ganttId = TG.body.id;

    const TG2 = await req('POST', '/api/gantts', { category_id: catId, name: 'גאנט בדיקות 2', type: 'annual', year: 2026 }, SA);
    ok(
      'יצירת גאנט שני (לבדיקות חסימת גישה)',
      'status 200 + id חדש',
      `status ${TG2.status}, id=${TG2.body.id}`,
      TG2.status === 200 && TG2.body.id
    );
    const ganttId2 = TG2.body?.id;

    // ════════════════════════════════════════════════════════════════════════════
    section('ניהול קטגוריות');
    // ════════════════════════════════════════════════════════════════════════════

    const patchCat = await req('PATCH', '/api/categories/' + catId, { name: 'בורד בדיקות — מעודכן' }, SA);
    ok(
      'שינוי שם קטגוריה על ידי סופראדמין',
      'status 200 + שם מעודכן',
      `status ${patchCat.status}, name="${patchCat.body.name}"`,
      patchCat.status === 200 && patchCat.body.name === 'בורד בדיקות — מעודכן'
    );

    const patchCatNoName = await req('PATCH', '/api/categories/' + catId, {}, SA);
    ok(
      'שינוי שם קטגוריה ללא שדה name',
      'שגיאה 400 — שדה חסר',
      `status ${patchCatNoName.status}`,
      patchCatNoName.status === 400
    );

    const emptyCat = await req('POST', '/api/categories', { name: 'קטגוריה ריקה זמנית', type: 'annual' }, SA);
    if (emptyCat.body?.id) {
      const delEmptyCat = await req('DELETE', '/api/categories/' + emptyCat.body.id, null, SA);
      ok(
        'מחיקת קטגוריה ריקה',
        'status 200 — מחיקה מוצלחת',
        `status ${delEmptyCat.status}`,
        delEmptyCat.status === 200
      );
    }

    const delFullCat = await req('DELETE', '/api/categories/' + catId, null, SA);
    ok(
      'ניסיון מחיקת קטגוריה שיש בה גאנטים',
      'שגיאה 400 — לא ניתן למחוק קטגוריה עם גאנטים',
      `status ${delFullCat.status}`,
      delFullCat.status === 400
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('ניהול גאנטים');
    // ════════════════════════════════════════════════════════════════════════════

    const getGantt = await req('GET', '/api/gantts/' + ganttId, null, SA);
    ok(
      'טעינת גאנט קיים על ידי סופראדמין',
      'status 200 + נתוני גאנט',
      `status ${getGantt.status}, name="${getGantt.body.name}"`,
      getGantt.status === 200 && getGantt.body.id === ganttId
    );

    const getGanttNotFound = await req('GET', '/api/gantts/99999', null, SA);
    ok(
      'טעינת גאנט שאינו קיים',
      'שגיאה 404 — גאנט לא נמצא',
      `status ${getGanttNotFound.status}`,
      getGanttNotFound.status === 404
    );

    const renameGantt = await req('PATCH', '/api/gantts/' + ganttId, { name: 'גאנט בדיקות — מעודכן' }, SA);
    ok(
      'שינוי שם גאנט על ידי סופראדמין',
      'status 200 + שם מעודכן',
      `status ${renameGantt.status}, name="${renameGantt.body.name}"`,
      renameGantt.status === 200
    );

    const saveState = await req('PATCH', '/api/gantts/' + ganttId + '/state', {}, SA);
    ok(
      'שמירת state של גאנט (גוף ריק)',
      'status 200 — שמירה מוצלחת',
      `status ${saveState.status}`,
      saveState.status === 200
    );

    const createGanttMissingFields = await req('POST', '/api/gantts', { name: 'חסר' }, SA);
    ok(
      'יצירת גאנט ללא שדות חובה (category_id, type)',
      'שגיאה 400 — שדות חסרים',
      `status ${createGanttMissingFields.status}`,
      createGanttMissingFields.status === 400
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('צופה (Viewer) — הרשאות');
    // ════════════════════════════════════════════════════════════════════════════

    const CV = await req('POST', '/api/auth/users', { email: 'viewer@test.com', password: 'viewer123', role: 'viewer', gantt_ids: [ganttId] }, SA);
    ok(
      'יצירת משתמש צופה עם הרשאה לגאנט אחד',
      'status 200 + id משתמש חדש',
      `status ${CV.status}, id=${CV.body.id}`,
      CV.status === 200 && CV.body.id
    );

    const VT = await otpLogin('viewer@test.com');
    ok(
      'התחברות צופה דרך OTP',
      'קבלת JWT token תקין',
      VT ? 'token התקבל' : 'לא התקבל token',
      !!VT
    );

    const VG = await req('GET', '/api/gantts/' + ganttId, null, VT);
    ok(
      'צופה מבקש גאנט שיש לו הרשאה אליו',
      'status 200 — גישה מורשית',
      `status ${VG.status}`,
      VG.status === 200
    );

    if (ganttId2) {
      const VG2 = await req('GET', '/api/gantts/' + ganttId2, null, VT);
      ok(
        'צופה מבקש גאנט שאין לו הרשאה אליו',
        'שגיאה 403 — גישה אסורה',
        `status ${VG2.status}`,
        VG2.status === 403
      );
    }

    const VS = await req('PATCH', '/api/gantts/' + ganttId + '/state', {}, VT);
    ok(
      'צופה מנסה לשמור state של גאנט',
      'שגיאה 403 — צופה אינו רשאי לערוך',
      `status ${VS.status}`,
      VS.status === 403
    );

    const VC = await req('POST', '/api/gantts', { category_id: catId, name: 'x', type: 'annual', year: 2026 }, VT);
    ok(
      'צופה מנסה ליצור גאנט חדש',
      'שגיאה 403 — צופה אינו רשאי ליצור',
      `status ${VC.status}`,
      VC.status === 403
    );

    const VDel = await req('DELETE', '/api/gantts/' + ganttId, null, VT);
    ok(
      'צופה מנסה למחוק גאנט',
      'שגיאה 403 — צופה אינו רשאי למחוק',
      `status ${VDel.status}`,
      VDel.status === 403
    );

    const VCatCreate = await req('POST', '/api/categories', { name: 'ניסיון', type: 'annual' }, VT);
    ok(
      'צופה מנסה ליצור קטגוריה',
      'שגיאה 403 — צופה אינו רשאי',
      `status ${VCatCreate.status}`,
      VCatCreate.status === 403
    );

    const VCats = await req('GET', '/api/categories', null, VT);
    const visibleGantts = Array.isArray(VCats.body)
      ? VCats.body.flatMap(c => c.gantts || []).map(g => g.id)
      : [];
    ok(
      'צופה מקבל רשימת קטגוריות — מסוננת לפי הרשאותיו בלבד',
      `רשימה עם גאנט id=${ganttId} בלבד`,
      JSON.stringify(visibleGantts),
      visibleGantts.length === 1 && visibleGantts[0] === ganttId
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('עורך (Editor) — הרשאות');
    // ════════════════════════════════════════════════════════════════════════════

    const CE = await req('POST', '/api/auth/users', { email: 'editor@test.com', password: 'editor123', role: 'editor', gantt_ids: [ganttId] }, SA);
    ok(
      'יצירת משתמש עורך עם הרשאה לגאנט אחד',
      'status 200 + id משתמש חדש',
      `status ${CE.status}, id=${CE.body.id}`,
      CE.status === 200 && CE.body.id
    );

    const ET = await otpLogin('editor@test.com');
    ok(
      'התחברות עורך דרך OTP',
      'קבלת JWT token תקין',
      ET ? 'token התקבל' : 'לא התקבל token',
      !!ET
    );

    const EG = await req('GET', '/api/gantts/' + ganttId, null, ET);
    ok(
      'עורך מבקש גאנט שיש לו הרשאה אליו',
      'status 200 — גישה מורשית',
      `status ${EG.status}`,
      EG.status === 200
    );

    if (ganttId2) {
      const EG2 = await req('GET', '/api/gantts/' + ganttId2, null, ET);
      ok(
        'עורך מבקש גאנט שאין לו הרשאה אליו',
        'שגיאה 403 — גישה אסורה',
        `status ${EG2.status}`,
        EG2.status === 403
      );
    }

    const ES = await req('PATCH', '/api/gantts/' + ganttId + '/state', {}, ET);
    ok(
      'עורך שומר state של גאנט שיש לו הרשאה אליו',
      'status 200 — שמירה מוצלחת',
      `status ${ES.status}`,
      ES.status === 200
    );

    const ESForbidden = await req('PATCH', '/api/gantts/' + ganttId2 + '/state', {}, ET);
    ok(
      'עורך מנסה לשמור state של גאנט שאין לו הרשאה',
      'שגיאה 403 — עריכה אסורה',
      `status ${ESForbidden.status}`,
      ESForbidden.status === 403
    );

    const ED = await req('DELETE', '/api/gantts/' + ganttId, null, ET);
    ok(
      'עורך מנסה למחוק גאנט',
      'שגיאה 403 — עורך אינו רשאי למחוק גאנטים',
      `status ${ED.status}`,
      ED.status === 403
    );

    const ECC = await req('POST', '/api/categories', { name: 'חדש', type: 'annual' }, ET);
    ok(
      'עורך מנסה ליצור קטגוריה חדשה',
      'שגיאה 403 — רק אדמין רשאי ליצור קטגוריות',
      `status ${ECC.status}`,
      ECC.status === 403
    );

    const EGC = await req('POST', '/api/gantts', { category_id: catId, name: 'גאנט עורך', type: 'annual', year: 2026 }, ET);
    ok(
      'עורך יוצר גאנט בבורד שיש לו גישה אליו',
      'status 200 + id גאנט חדש',
      `status ${EGC.status}, id=${EGC.body.id}`,
      EGC.status === 200 && EGC.body.id
    );

    if (EGC.body?.id) {
      const euPerms = (await req('GET', '/api/auth/users', null, SA)).body
        .find(u => u.email === 'editor@test.com');
      ok(
        'הרשאה אוטומטית לעורך על גאנט שיצר',
        `הרשאת גאנט id=${EGC.body.id} נוספה אוטומטית`,
        `gantt_ids=${JSON.stringify(euPerms?.gantt_ids)}`,
        euPerms?.gantt_ids?.includes(EGC.body.id)
      );
      await req('DELETE', '/api/gantts/' + EGC.body.id, null, SA);
    }

    const NC = await req('POST', '/api/categories', { name: 'בורד סגור', type: 'annual' }, SA);
    if (NC.body?.id) {
      const EGN = await req('POST', '/api/gantts', { category_id: NC.body.id, name: 'אסור', type: 'annual', year: 2026 }, ET);
      ok(
        'עורך מנסה ליצור גאנט בבורד שאין לו גישה אליו',
        'שגיאה 403 — אין הרשאה לבורד זה',
        `status ${EGN.status}`,
        EGN.status === 403
      );
      await req('DELETE', '/api/categories/' + NC.body.id, null, SA);
    }

    // ════════════════════════════════════════════════════════════════════════════
    section('מנהל (Admin) — הרשאות');
    // ════════════════════════════════════════════════════════════════════════════

    const CA = await req('POST', '/api/auth/users', { email: 'admin@test.com', password: 'admin123', role: 'admin' }, SA);
    ok(
      'יצירת משתמש אדמין על ידי סופראדמין',
      'status 200 + id משתמש חדש',
      `status ${CA.status}, id=${CA.body.id}`,
      CA.status === 200 && CA.body.id
    );

    const AT = await otpLogin('admin@test.com');
    ok(
      'התחברות אדמין דרך OTP',
      'קבלת JWT token תקין',
      AT ? 'token התקבל' : 'לא התקבל token',
      !!AT
    );

    const AGantt = await req('GET', '/api/gantts/' + ganttId, null, AT);
    ok(
      'אדמין מבקש גאנט (ללא הרשאה ספציפית)',
      'שגיאה 403 — אדמין צריך הרשאה מפורשת לגאנט',
      `status ${AGantt.status}`,
      AGantt.status === 403
    );

    const AUsers = await req('GET', '/api/auth/users', null, AT);
    ok(
      'אדמין מבקש רשימת משתמשים',
      'status 200 + מערך משתמשים',
      `status ${AUsers.status}, ${AUsers.body.length} משתמשים`,
      AUsers.status === 200 && Array.isArray(AUsers.body)
    );

    const ACatCreate = await req('POST', '/api/categories', { name: 'קטגוריה אדמין', type: 'annual' }, AT);
    ok(
      'אדמין יוצר קטגוריה חדשה',
      'status 200 — אדמין רשאי ליצור קטגוריות',
      `status ${ACatCreate.status}`,
      ACatCreate.status === 200
    );
    if (ACatCreate.body?.id) await req('DELETE', '/api/categories/' + ACatCreate.body.id, null, SA);

    const superAdminId = AUsers.body.find(u => u.role === 'superadmin')?.id;
    if (superAdminId) {
      const AEditSA = await req('PATCH', '/api/auth/users/' + superAdminId, { email: 'hacked@test.com' }, AT);
      ok(
        'אדמין מנסה לערוך משתמש סופראדמין',
        'שגיאה 403 — אדמין אינו רשאי לערוך סופראדמין',
        `status ${AEditSA.status}`,
        AEditSA.status === 403
      );
    }

    const adminUserId = CA.body.id;
    const ADelSelf = await req('DELETE', '/api/auth/users/' + adminUserId, null, AT);
    ok(
      'אדמין מנסה למחוק את עצמו',
      'שגיאה 400 — לא ניתן למחוק את המשתמש הנוכחי',
      `status ${ADelSelf.status}`,
      ADelSelf.status === 400
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('הרשאות מורחבות — שינויים חדשים');
    // ════════════════════════════════════════════════════════════════════════════

    // --- user_all_access ---
    const CUA = await req('POST', '/api/auth/users', { email: 'allaccess@test.com', role: 'editor', all_access: true }, SA);
    ok(
      'סופראדמין יוצר משתמש עם all_access',
      'status 200 + id משתמש חדש',
      `status ${CUA.status}, id=${CUA.body.id}`,
      CUA.status === 200 && CUA.body.id
    );
    const uaId = CUA.body?.id;

    if (uaId) {
      const UAUsersList = (await req('GET', '/api/auth/users', null, SA)).body;
      const uaUser = UAUsersList.find(u => u.email === 'allaccess@test.com');
      ok(
        'משתמש all_access מסומן כראוי בנתוני המשתמש',
        'all_access === true',
        `all_access=${uaUser?.all_access}`,
        uaUser?.all_access === true
      );

      const UAT = await otpLogin('allaccess@test.com');
      ok(
        'התחברות משתמש all_access דרך OTP',
        'קבלת JWT token תקין',
        UAT ? 'token התקבל' : 'לא התקבל token',
        !!UAT
      );

      if (UAT && ganttId2) {
        const UAG2 = await req('GET', '/api/gantts/' + ganttId2, null, UAT);
        ok(
          'משתמש all_access מבקש גאנט שלא הוקצה לו ספציפית',
          'status 200 — all_access מאפשר גישה לכל הגאנטים',
          `status ${UAG2.status}`,
          UAG2.status === 200
        );
      }

      // שלילת all_access על-ידי admin — אסור
      const ARemoveAllAccess = await req('PATCH', '/api/auth/users/' + uaId, { all_access: false, gantt_ids: [] }, AT);
      ok(
        'אדמין מנסה לשנות all_access של משתמש',
        'שגיאה 403 — רק סופראדמין יכול לנהל all_access',
        `status ${ARemoveAllAccess.status}`,
        ARemoveAllAccess.status === 403
      );

      // הסרת all_access על-ידי סופראדמין — מותר
      const SARemoveAllAccess = await req('PATCH', '/api/auth/users/' + uaId, { all_access: false, gantt_ids: [ganttId] }, SA);
      ok(
        'סופראדמין מסיר all_access ומגביל לגאנט ספציפי',
        'status 200 — עדכון הצליח',
        `status ${SARemoveAllAccess.status}`,
        SARemoveAllAccess.status === 200
      );

      if (SARemoveAllAccess.status === 200 && ganttId2) {
        const UAT2 = await otpLogin('allaccess@test.com');
        if (UAT2) {
          const UAG2After = await req('GET', '/api/gantts/' + ganttId2, null, UAT2);
          ok(
            'לאחר הסרת all_access — גישה לגאנט שלא הוקצה אסורה',
            'שגיאה 403 — גישה נחסמה',
            `status ${UAG2After.status}`,
            UAG2After.status === 403
          );
        }
      }

      await req('DELETE', '/api/auth/users/' + uaId, null, SA);
    }

    // --- admin רואה רק משתמשים שיצר ---
    const CByAdmin = await req('POST', '/api/auth/users', { email: 'created-by-admin@test.com', role: 'viewer', gantt_ids: [ganttId] }, AT);
    ok(
      'אדמין יוצר משתמש viewer',
      'status 200 + id משתמש חדש',
      `status ${CByAdmin.status}, id=${CByAdmin.body.id}`,
      CByAdmin.status === 200 && CByAdmin.body.id
    );

    const AdminUsersView = await req('GET', '/api/auth/users', null, AT);
    ok(
      'אדמין מקבל רשימת משתמשים — רק משתמשים שיצר',
      'הרשימה לא כוללת משתמשי סופראדמין או משתמשים של אדמין אחר',
      `${AdminUsersView.body.length} משתמשים, emails: ${AdminUsersView.body.map(u => u.email).join(', ')}`,
      AdminUsersView.body.every(u => u.role !== 'superadmin') &&
      AdminUsersView.body.some(u => u.email === 'created-by-admin@test.com')
    );

    // --- admin לא יכול לערוך/למחוק משתמש שיצר אדמין אחר ---
    const AEditForeign = await req('PATCH', '/api/auth/users/' + CV.body.id, { is_active: false }, AT);
    ok(
      'אדמין מנסה לערוך משתמש שנוצר על ידי סופראדמין (לא שלו)',
      'שגיאה 403 — אין הרשאה',
      `status ${AEditForeign.status}`,
      AEditForeign.status === 403
    );

    const ADelForeign = await req('DELETE', '/api/auth/users/' + CV.body.id, null, AT);
    ok(
      'אדמין מנסה למחוק משתמש שנוצר על ידי סופראדמין (לא שלו)',
      'שגיאה 403 — אין הרשאה',
      `status ${ADelForeign.status}`,
      ADelForeign.status === 403
    );

    // --- admin לא יכול להעניק הרשאות מעבר לשלו ---
    if (ganttId2) {
      const AGrantExcess = await req('PATCH', '/api/auth/users/' + CByAdmin.body.id, { gantt_ids: [ganttId, ganttId2] }, AT);
      const updatedUser = (await req('GET', '/api/auth/users', null, SA)).body.find(u => u.email === 'created-by-admin@test.com');
      ok(
        'אדמין מנסה להעניק הרשאה לגאנט שאין לו גישה אליו',
        'ההרשאה ל-ganttId2 לא נוספת (clamp להרשאות האדמין)',
        `gantt_ids של המשתמש: ${JSON.stringify(updatedUser?.gantt_ids)}`,
        !updatedUser?.gantt_ids?.includes(ganttId2)
      );
    }

    // --- מחיקת אדמין — המשתמשים שיצר נשארים (אין cascade delete) ---
    const adminIdForCascade = CA.body.id;
    await req('DELETE', '/api/auth/users/' + adminIdForCascade, null, SA);
    const allAfterDel = (await req('GET', '/api/auth/users', null, SA)).body;
    ok(
      'מחיקת אדמין — משתמשים שיצר נשארים במערכת',
      'created-by-admin@test.com עדיין קיים לאחר מחיקת האדמין',
      `created-by-admin@test.com קיים: ${allAfterDel.some(u => u.email === 'created-by-admin@test.com')}`,
      allAfterDel.some(u => u.email === 'created-by-admin@test.com')
    );

    // --- endpoint preview מייל — superadmin בלבד ---
    const PreviewSA = await req('POST', '/api/auth/email/preview', { type: 'otp', to: 'gal@finitione.com' }, SA);
    ok(
      'סופראדמין שולח preview מייל',
      'status 200 — שליחה הצליחה',
      `status ${PreviewSA.status}`,
      PreviewSA.status === 200
    );

    const PreviewViewer = await req('POST', '/api/auth/email/preview', { type: 'otp', to: 'gal@finitione.com' }, VT);
    ok(
      'צופה מנסה לגשת ל-endpoint preview מייל',
      'שגיאה 403 — גישה אסורה',
      `status ${PreviewViewer.status}`,
      PreviewViewer.status === 403
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('ניהול צוותים');
    // ════════════════════════════════════════════════════════════════════════════

    const TM = await req('POST', '/api/teams', { name: 'צוות בדיקה' }, SA);
    ok(
      'יצירת צוות חדש',
      'status 200 + id צוות',
      `status ${TM.status}, id=${TM.body.id}`,
      TM.status === 200 && TM.body.id
    );
    const teamId = TM.body?.id;

    if (teamId) {
      const TMember = await req('POST', '/api/teams/' + teamId + '/members', { name: 'ישראל ישראלי', role: 'מפתח' }, SA);
      ok(
        'הוספת חבר לצוות',
        'status 200 + id חבר חדש',
        `status ${TMember.status}, id=${TMember.body.id}`,
        TMember.status === 200 && TMember.body.id
      );
      const memberId = TMember.body?.id;

      if (memberId) {
        const TUpdateMember = await req('PATCH', '/api/teams/' + teamId + '/members/' + memberId, { role: 'בודק' }, SA);
        ok(
          'עדכון תפקיד חבר בצוות',
          'status 200 + תפקיד מעודכן',
          `status ${TUpdateMember.status}, role="${TUpdateMember.body.role}"`,
          TUpdateMember.status === 200 && TUpdateMember.body.role === 'בודק'
        );

        const TDelMember = await req('DELETE', '/api/teams/' + teamId + '/members/' + memberId, null, SA);
        ok(
          'מחיקת חבר מצוות',
          'status 200 — מחיקה מוצלחת',
          `status ${TDelMember.status}`,
          TDelMember.status === 200
        );
      }

      const TGetTeams = await req('GET', '/api/teams', null, SA);
      ok(
        'קבלת רשימת כל הצוותים',
        'status 200 + מערך צוותים',
        `status ${TGetTeams.status}, ${TGetTeams.body.length} צוותים`,
        TGetTeams.status === 200 && Array.isArray(TGetTeams.body)
      );

      const TUpdateTeam = await req('PATCH', '/api/teams/' + teamId, { name: 'צוות בדיקה — מעודכן' }, SA);
      ok(
        'שינוי שם צוות',
        'status 200 + שם מעודכן',
        `status ${TUpdateTeam.status}`,
        TUpdateTeam.status === 200
      );

      const TDelTeam = await req('DELETE', '/api/teams/' + teamId, null, SA);
      ok(
        'מחיקת צוות',
        'status 200 — מחיקה מוצלחת',
        `status ${TDelTeam.status}`,
        TDelTeam.status === 200
      );
    }

    // ════════════════════════════════════════════════════════════════════════════
    section('מקרי קצה');
    // ════════════════════════════════════════════════════════════════════════════

    const DUP = await req('POST', '/api/auth/users', { email: 'editor@test.com', password: 'xyz123', role: 'viewer' }, SA);
    ok(
      'יצירת משתמש עם מייל שכבר קיים במערכת',
      'שגיאה 409 — מייל כבר קיים',
      `status ${DUP.status}`,
      DUP.status === 409
    );

    const SHORT = await req('POST', '/api/auth/users', { email: 'short@test.com', role: 'viewer' }, SA);
    ok(
      'יצירת משתמש ללא סיסמה (מערכת OTP)',
      'status 200 — אין צורך בסיסמה, כניסה דרך OTP בלבד',
      `status ${SHORT.status}`,
      SHORT.status === 200
    );

    const NOAUTH = await req('GET', '/api/categories', null, null);
    ok(
      'בקשה לנתונים ללא token כלל',
      'שגיאה 401 — נדרשת התחברות',
      `status ${NOAUTH.status}`,
      NOAUTH.status === 401
    );

    const BADTOKEN = await req('GET', '/api/categories', null, 'invalid.token.here');
    ok(
      'בקשה עם token לא תקין',
      'שגיאה 401 — token לא תקין',
      `status ${BADTOKEN.status}`,
      BADTOKEN.status === 401
    );

    const NOTEAM = await req('POST', '/api/teams', {}, SA);
    ok(
      'יצירת צוות ללא שם',
      'שגיאה 400 — שדה name חסר',
      `status ${NOTEAM.status}`,
      NOTEAM.status === 400
    );

    const NOCAT = await req('POST', '/api/categories', { type: 'annual' }, SA);
    ok(
      'יצירת קטגוריה ללא שם',
      'שגיאה 400 — שדה name חסר',
      `status ${NOCAT.status}`,
      NOCAT.status === 400
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('לוגים ותיעוד');
    // ════════════════════════════════════════════════════════════════════════════

    const today = new Date().toISOString().slice(0, 10);

    const LA = await req('GET', '/api/auth/logs?date=' + today, null, SA);
    ok(
      'סופראדמין מבקש לוג פעולות של היום',
      'status 200 + מערך רשומות',
      `status ${LA.status}, ${Array.isArray(LA.body) ? LA.body.length : '?'} רשומות`,
      LA.status === 200 && Array.isArray(LA.body)
    );

    const LF = await req('GET', '/api/auth/logs?date=' + today + '&action=create_user', null, SA);
    ok(
      'סינון לוג לפי פעולה create_user',
      'status 200 + רשומות מסוננות',
      `status ${LF.status}, ${LF.body.length} רשומות`,
      LF.status === 200 && Array.isArray(LF.body)
    );

    const LFU = await req('GET', '/api/auth/logs?date=' + today + '&user=gal', null, SA);
    ok(
      'סינון לוג לפי שם משתמש "gal"',
      'status 200 + רשומות מסוננות',
      `status ${LFU.status}, ${LFU.body.length} רשומות`,
      LFU.status === 200 && Array.isArray(LFU.body)
    );

    const LE = await req('GET', '/api/auth/logs?date=' + today, null, ET);
    ok(
      'עורך מנסה לגשת ללוג פעולות',
      'שגיאה 403 — גישה ללוגים מוגבלת לאדמין ומעלה',
      `status ${LE.status}`,
      LE.status === 403
    );

    const LV = await req('GET', '/api/auth/logs?date=' + today, null, VT);
    ok(
      'צופה מנסה לגשת ללוג פעולות',
      'שגיאה 403 — גישה ללוגים מוגבלת לאדמין ומעלה',
      `status ${LV.status}`,
      LV.status === 403
    );

    const LD = await req('GET', '/api/auth/logs/dates', null, SA);
    ok(
      'קבלת רשימת תאריכים שיש בהם לוגים',
      'status 200 + מערך תאריכים',
      `status ${LD.status}, ${JSON.stringify(LD.body)}`,
      LD.status === 200 && Array.isArray(LD.body)
    );

    const logFile = path.join(__dirname, 'logs', today + '.log');
    const lines = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    ok(
      'קובץ לוג נכתב לדיסק',
      'קובץ לוג קיים עם לפחות רשומה אחת',
      `${lines.length} שורות בקובץ`,
      lines.length > 0
    );

    // ════════════════════════════════════════════════════════════════════════════
    section('ניקוי נתוני בדיקה');
    // ════════════════════════════════════════════════════════════════════════════

    await req('DELETE', '/api/gantts/' + ganttId, null, SA);
    if (ganttId2) await req('DELETE', '/api/gantts/' + ganttId2, null, SA);
    await req('DELETE', '/api/categories/' + catId, null, SA);

    const allUsers = (await req('GET', '/api/auth/users', null, SA)).body;
    for (const u of allUsers.filter(u => u.email.endsWith('@test.com'))) {
      await req('DELETE', '/api/auth/users/' + u.id, null, SA);
      console.log('   נמחק:', u.email);
    }

  } finally {
    const endTime = Date.now();
    const passed  = results.filter(r => r.passed).length;
    const failed  = results.filter(r => !r.passed).length;

    // ── ייצוא דוח HTML ────────────────────────────────────────────────────────
    const reportDir = path.join(__dirname, 'test-reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(reportDir, `report-${timestamp}.html`);
    fs.writeFileSync(reportPath, generateReport(startTime, endTime), 'utf8');

    console.log(`\n📊 דוח: test-reports/report-${timestamp}.html`);
    console.log(`\n[SUMMARY] ${failed === 0 ? 'passed' : 'failed'} ${passed}/${results.length} עברו`);

    serverProc.kill();
  }
}

// ── גנרטור דוח HTML ───────────────────────────────────────────────────────────
function generateReport(startTime, endTime) {
  const passed   = results.filter(r => r.passed).length;
  const failed   = results.filter(r => !r.passed).length;
  const total    = results.length;
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  const dateStr  = new Date(startTime).toLocaleString('he-IL');
  const pct      = total > 0 ? Math.round(passed / total * 100) : 0;

  const sections = [...new Set(results.map(r => r.section))];

  const sectionHtml = sections.map(sec => {
    const rows = results.filter(r => r.section === sec);
    const secPassed = rows.filter(r => r.passed).length;
    const secFailed = rows.filter(r => !r.passed).length;

    const rowsHtml = rows.map(r => `
      <tr class="${r.passed ? 'pass' : 'fail'}">
        <td class="status-cell">${r.passed ? '✅' : '❌'}</td>
        <td class="action-cell">${r.action}</td>
        <td class="expected-cell">${r.expected}</td>
        <td class="actual-cell">${r.actual}</td>
        <td class="result-cell ${r.passed ? 'pass-text' : 'fail-text'}">${r.passed ? 'עבר' : 'נכשל'}</td>
      </tr>`).join('');

    return `
    <div class="section">
      <div class="section-header">
        <span class="section-name">${sec}</span>
        <span class="section-stats">
          <span class="badge pass-badge">${secPassed} עברו</span>
          ${secFailed > 0 ? `<span class="badge fail-badge">${secFailed} נכשלו</span>` : ''}
        </span>
      </div>
      <table>
        <colgroup>
          <col class="col-status">
          <col class="col-action">
          <col class="col-expected">
          <col class="col-actual">
          <col class="col-result">
        </colgroup>
        <thead>
          <tr>
            <th></th>
            <th>פעולה</th>
            <th>תוצאה רצויה</th>
            <th>תוצאה בפועל</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Planner — דוח בדיקות ${dateStr}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #f1f5f9; color: #0f172a; direction: rtl; }

    header { background: #1e293b; color: #fff; padding: 28px 40px; }
    header h1 { font-size: 22px; font-weight: 800; }
    header p  { font-size: 13px; color: #94a3b8; margin-top: 4px; }

    .summary { display: flex; gap: 16px; padding: 24px 40px; flex-wrap: wrap; }
    .card { background: #fff; border-radius: 12px; padding: 20px 28px; box-shadow: 0 1px 6px rgba(0,0,0,.08); min-width: 140px; text-align: center; }
    .card .num { font-size: 36px; font-weight: 800; line-height: 1; }
    .card .lbl { font-size: 13px; color: #64748b; margin-top: 4px; }
    .card.total .num { color: #1e293b; }
    .card.pass  .num { color: #16a34a; }
    .card.fail  .num { color: #dc2626; }
    .card.time  .num { font-size: 26px; color: #7c3aed; }

    .status-bar { margin: 0 40px 24px; height: 8px; border-radius: 99px; background: #fee2e2; overflow: hidden; }
    .status-bar-fill { height: 100%; border-radius: 99px; background: #16a34a; width: ${pct}%; }

    .sections { padding: 0 40px 40px; display: flex; flex-direction: column; gap: 20px; }
    .section { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 6px rgba(0,0,0,.07); }
    .section-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .section-name { font-weight: 700; font-size: 15px; }
    .section-stats { display: flex; gap: 8px; }
    .badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 99px; }
    .pass-badge { background: #dcfce7; color: #166534; }
    .fail-badge { background: #fee2e2; color: #991b1b; }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead tr { background: #f1f5f9; }
    th { padding: 10px 16px; font-size: 12px; color: #64748b; font-weight: 600; text-align: right; border-bottom: 1px solid #e2e8f0; white-space: nowrap; overflow: hidden; }
    td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #f1f5f9; vertical-align: top; word-break: break-word; }
    tr:last-child td { border-bottom: none; }
    tr.fail { background: #fff8f8; }

    col.col-status   { width: 52px; }
    col.col-action   { width: 26%; }
    col.col-expected { width: 30%; }
    col.col-actual   { width: 30%; }
    col.col-result   { width: 80px; }

    td.status-cell { text-align: center; font-size: 16px; }
    td.action-cell { font-weight: 600; color: #0f172a; }
    td.expected-cell { color: #475569; }
    td.actual-cell { font-family: monospace; font-size: 12px; color: #64748b; }
    td.result-cell { text-align: center; font-weight: 700; font-size: 12px; white-space: nowrap; }
    .pass-text { color: #16a34a; }
    .fail-text { color: #dc2626; }

    .footer { text-align: center; padding: 24px; color: #94a3b8; font-size: 12px; }
  </style>
</head>
<body>
<header>
  <h1>Planner — דוח בדיקות אוטומטיות</h1>
  <p>הופק ב: ${dateStr} &nbsp;|&nbsp; משך ריצה: ${duration} שניות</p>
</header>

<div class="summary">
  <div class="card total"><div class="num">${total}</div><div class="lbl">סה"כ בדיקות</div></div>
  <div class="card pass"><div class="num">${passed}</div><div class="lbl">עברו</div></div>
  <div class="card fail"><div class="num">${failed}</div><div class="lbl">נכשלו</div></div>
  <div class="card time"><div class="num">${duration}s</div><div class="lbl">זמן ריצה</div></div>
</div>

<div class="status-bar"><div class="status-bar-fill"></div></div>

<div class="sections">${sectionHtml}</div>

<div class="footer">Planner Test Suite • ${dateStr}</div>
</body>
</html>`;
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
