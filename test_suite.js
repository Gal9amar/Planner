/**
 * Planner — Test Suite
 * Usage: node test_suite.js
 *
 * Starts the server with TEST_MODE=1 (no emails sent), runs all tests,
 * exports an HTML report to test-reports/, then shuts down.
 */

const { spawn }  = require('child_process');
const http       = require('http');
const fs         = require('fs');
const path       = require('path');

// ── Kill any process on port 3011, then start server with TEST_MODE ──────────
function killPort(port) {
  return new Promise(resolve => {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32'
      ? `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /F /PID %a`
      : `lsof -ti:${port} | xargs kill -9`;
    exec(cmd, () => setTimeout(resolve, 500));
  });
}

function startServer() {
  return new Promise(async (resolve, reject) => {
    await killPort(3011);

    const proc = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: { ...process.env, TEST_MODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', d => {
      const line = d.toString();
      if (line.includes('listening') || line.includes('3011')) resolve(proc);
    });
    proc.stderr.on('data', d => process.stderr.write(d));
    proc.on('error', reject);

    // fallback: give server 3 seconds to start
    setTimeout(() => resolve(proc), 3000);
  });
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function req(method, reqPath, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ hostname: 'localhost', port: 3011, path: reqPath, method, headers }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    if (data) r.write(data);
    r.end();
  });
}

// ── Test result tracking ──────────────────────────────────────────────────────
const results = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log('\n=== ' + name + ' ===');
}

function ok(label, cond, extra) {
  const result = { section: currentSection, label, passed: !!cond, extra: extra || null };
  results.push(result);
  console.log((cond ? '✅' : '❌') + ' ' + label + (extra ? ' — ' + extra : ''));
}

// ── OTP login (reads code directly from DB — no email needed) ─────────────────
function otpLogin(email) {
  const db = require('./db');
  return (async () => {
    await req('POST', '/workgant/api/auth/otp/request', { email });
    const row = db.prepare(
      `SELECT code FROM otp_codes WHERE email=? COLLATE NOCASE AND used=0 ORDER BY id DESC LIMIT 1`
    ).get(email);
    if (!row) return null;
    const res = await req('POST', '/workgant/api/auth/otp/verify', { email, code: row.code });
    return res.status === 200 ? res.body.token : null;
  })();
}

// ── HTML report generator ─────────────────────────────────────────────────────
function generateReport(startTime, endTime) {
  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed).length;
  const total   = results.length;
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  const dateStr  = new Date(startTime).toLocaleString('he-IL');

  const sections = [...new Set(results.map(r => r.section))];

  const sectionHtml = sections.map(sec => {
    const rows = results.filter(r => r.section === sec);
    const secPassed = rows.filter(r => r.passed).length;
    const secFailed = rows.filter(r => !r.passed).length;
    const rowsHtml = rows.map(r => `
      <tr class="${r.passed ? 'pass' : 'fail'}">
        <td class="icon">${r.passed ? '✅' : '❌'}</td>
        <td class="label">${r.label}</td>
        <td class="extra">${r.extra ? r.extra : '—'}</td>
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
        <thead><tr><th style="width:40px"></th><th>בדיקה</th><th>פרטים</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Planner — דוח בדיקות</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; background: #f1f5f9; color: #0f172a; direction: rtl; }

    header { background: #1e293b; color: #fff; padding: 28px 40px; }
    header h1 { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
    header p  { font-size: 13px; color: #94a3b8; margin-top: 4px; }

    .summary {
      display: flex; gap: 16px; padding: 24px 40px; flex-wrap: wrap;
    }
    .card {
      background: #fff; border-radius: 12px; padding: 20px 28px;
      box-shadow: 0 1px 6px rgba(0,0,0,.08); min-width: 140px; text-align: center;
    }
    .card .num  { font-size: 36px; font-weight: 800; line-height: 1; }
    .card .lbl  { font-size: 13px; color: #64748b; margin-top: 4px; }
    .card.total .num { color: #1e293b; }
    .card.pass  .num { color: #16a34a; }
    .card.fail  .num { color: #dc2626; }
    .card.time  .num { font-size: 26px; color: #7c3aed; }

    .status-bar {
      margin: 0 40px 24px; height: 8px; border-radius: 99px;
      background: #fee2e2; overflow: hidden;
    }
    .status-bar-fill {
      height: 100%; border-radius: 99px; background: #16a34a;
      width: ${total > 0 ? Math.round(passed/total*100) : 0}%;
      transition: width .4s;
    }

    .sections { padding: 0 40px 40px; display: flex; flex-direction: column; gap: 20px; }

    .section { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 6px rgba(0,0,0,.07); }
    .section-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
    }
    .section-name { font-weight: 700; font-size: 15px; }
    .section-stats { display: flex; gap: 8px; }
    .badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 99px; }
    .pass-badge { background: #dcfce7; color: #166534; }
    .fail-badge { background: #fee2e2; color: #991b1b; }

    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f1f5f9; }
    th { padding: 10px 16px; font-size: 12px; color: #64748b; font-weight: 600; text-align: right; border-bottom: 1px solid #e2e8f0; }
    td { padding: 11px 16px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }
    tr.pass td.icon { color: #16a34a; }
    tr.fail td.icon { color: #dc2626; }
    tr.fail { background: #fff5f5; }
    td.icon { width: 40px; text-align: center; font-size: 16px; }
    td.extra { color: #64748b; font-size: 13px; font-family: monospace; }

    .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
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

<div class="sections">
  ${sectionHtml}
</div>

<div class="footer">Planner Test Suite • ${dateStr}</div>

</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('Starting server with TEST_MODE=1...');
  const serverProc = await startServer();
  const startTime = Date.now();

  try {
    const db = require('./db');

    // cleanup leftovers from previous run
    db.prepare(`DELETE FROM users WHERE email LIKE '%@test.com'`).run();

    // ── AUTH ────────────────────────────────────────────────────────────────
    section('AUTH');
    const SA = await otpLogin('gal@finitione.com');
    ok('Login superadmin via OTP', !!SA, SA ? 'token ok' : 'no token');
    if (!SA) { console.log('ABORT: no token'); serverProc.kill(); process.exit(1); }

    const LM = await req('POST', '/workgant/api/auth/otp/request', {});
    ok('OTP request missing email (expect 400)', LM.status === 400);

    const LU = await req('POST', '/workgant/api/auth/otp/verify', { email: 'noexist@test.com', code: '000000' });
    ok('OTP verify nonexistent user (expect 401 or 400)', LU.status === 400 || LU.status === 401);

    const BADOTP = await req('POST', '/workgant/api/auth/otp/verify', { email: 'gal@finitione.com', code: '000000' });
    ok('OTP verify wrong code (expect 401)', BADOTP.status === 401);

    // ── SETUP ───────────────────────────────────────────────────────────────
    section('SETUP');
    const TCAT = await req('POST', '/workgant/api/categories', { name: 'בורד בדיקות', type: 'annual' }, SA);
    ok('Create test category', TCAT.status === 200, 'id=' + TCAT.body.id);
    if (!TCAT.body?.id) { console.log('ABORT: no test category'); serverProc.kill(); process.exit(1); }
    const catId = TCAT.body.id;

    const TG = await req('POST', '/workgant/api/gantts', { category_id: catId, name: 'גאנט בדיקות', type: 'annual', year: 2026 }, SA);
    ok('Create test gantt', TG.status === 200, 'id=' + TG.body.id);
    if (!TG.body?.id) { console.log('ABORT: no test gantt'); serverProc.kill(); process.exit(1); }
    const ganttId = TG.body.id;

    const TG2 = await req('POST', '/workgant/api/gantts', { category_id: catId, name: 'גאנט בדיקות 2', type: 'annual', year: 2026 }, SA);
    ok('Create second test gantt', TG2.status === 200, 'id=' + TG2.body.id);
    const ganttId2 = TG2.body?.id;

    // ── VIEWER ──────────────────────────────────────────────────────────────
    section('VIEWER');
    const CV = await req('POST', '/workgant/api/auth/users', { email: 'viewer@test.com', password: 'viewer123', role: 'viewer', gantt_ids: [ganttId] }, SA);
    ok('Create viewer', CV.status === 200, 'id=' + CV.body.id);
    const VT = await otpLogin('viewer@test.com');
    ok('Viewer login via OTP', !!VT);

    const VG = await req('GET', '/workgant/api/gantts/' + ganttId, null, VT);
    ok('Viewer GET permitted gantt', VG.status === 200);

    if (ganttId2) {
      const VG2 = await req('GET', '/workgant/api/gantts/' + ganttId2, null, VT);
      ok('Viewer GET non-permitted gantt (expect 403)', VG2.status === 403);
    }

    const VS = await req('PATCH', '/workgant/api/gantts/' + ganttId + '/state', {}, VT);
    ok('Viewer PATCH state (expect 403)', VS.status === 403);

    const VC = await req('POST', '/workgant/api/gantts', { category_id: catId, name: 'x', type: 'annual', year: 2026 }, VT);
    ok('Viewer CREATE gantt (expect 403)', VC.status === 403);

    const VCats = await req('GET', '/workgant/api/categories', null, VT);
    const visibleGantts = Array.isArray(VCats.body) ? VCats.body.flatMap(c => c.gantts || []).map(g => g.id) : [];
    ok('Viewer sees only permitted gantts', visibleGantts.length === 1 && visibleGantts[0] === ganttId, JSON.stringify(visibleGantts));

    // ── EDITOR ──────────────────────────────────────────────────────────────
    section('EDITOR');
    const CE = await req('POST', '/workgant/api/auth/users', { email: 'editor@test.com', password: 'editor123', role: 'editor', gantt_ids: [ganttId] }, SA);
    ok('Create editor', CE.status === 200, 'id=' + CE.body.id);
    const ET = await otpLogin('editor@test.com');
    ok('Editor login via OTP', !!ET);

    const EG = await req('GET', '/workgant/api/gantts/' + ganttId, null, ET);
    ok('Editor GET permitted gantt', EG.status === 200);

    if (ganttId2) {
      const EG2 = await req('GET', '/workgant/api/gantts/' + ganttId2, null, ET);
      ok('Editor GET non-permitted gantt (expect 403)', EG2.status === 403);
    }

    const ES = await req('PATCH', '/workgant/api/gantts/' + ganttId + '/state', {}, ET);
    ok('Editor PATCH state permitted gantt', ES.status === 200);

    const ED = await req('DELETE', '/workgant/api/gantts/' + ganttId, null, ET);
    ok('Editor DELETE gantt (expect 403)', ED.status === 403);

    const ECC = await req('POST', '/workgant/api/categories', { name: 'חדש', type: 'annual' }, ET);
    ok('Editor CREATE category (expect 403)', ECC.status === 403);

    const EGC = await req('POST', '/workgant/api/gantts', { category_id: catId, name: 'גאנט עורך', type: 'annual', year: 2026 }, ET);
    ok('Editor CREATE gantt in accessible board', EGC.status === 200, 'id=' + EGC.body.id);
    if (EGC.body?.id) {
      const euPerms = (await req('GET', '/workgant/api/auth/users', null, SA)).body.find(u => u.email === 'editor@test.com');
      ok('Auto-perm on new gantt', euPerms?.gantt_ids?.includes(EGC.body.id), JSON.stringify(euPerms?.gantt_ids));
      await req('DELETE', '/workgant/api/gantts/' + EGC.body.id, null, SA);
    }

    const NC = await req('POST', '/workgant/api/categories', { name: 'בורד נסיון', type: 'annual' }, SA);
    if (NC.body?.id) {
      const EGN = await req('POST', '/workgant/api/gantts', { category_id: NC.body.id, name: 'אסור', type: 'annual', year: 2026 }, ET);
      ok('Editor CREATE in no-access board (expect 403)', EGN.status === 403);
      await req('DELETE', '/workgant/api/categories/' + NC.body.id, null, SA);
    }

    // ── ADMIN ────────────────────────────────────────────────────────────────
    section('ADMIN');
    const CA = await req('POST', '/workgant/api/auth/users', { email: 'admin@test.com', password: 'admin123', role: 'admin' }, SA);
    ok('Create admin', CA.status === 200, 'id=' + CA.body.id);
    const AT = await otpLogin('admin@test.com');
    ok('Admin login via OTP', !!AT);

    const AGantts = await req('GET', '/workgant/api/gantts/' + ganttId, null, AT);
    ok('Admin GET any gantt', AGantts.status === 200);

    const AUsers = await req('GET', '/workgant/api/auth/users', null, AT);
    ok('Admin GET /users', AUsers.status === 200, AUsers.body.length + ' users');

    const superAdminId = AUsers.body.find(u => u.role === 'superadmin')?.id;
    if (superAdminId) {
      const AE = await req('PATCH', '/workgant/api/auth/users/' + superAdminId, { email: 'hacked@test.com' }, AT);
      ok('Admin edit superadmin (expect 403)', AE.status === 403);
    }

    const adminUserId = CA.body.id || AUsers.body.find(u => u.email === 'admin@test.com')?.id;
    const ASelf = await req('DELETE', '/workgant/api/auth/users/' + adminUserId, null, AT);
    ok('Admin delete self (expect 400)', ASelf.status === 400);

    // ── EDGE CASES ───────────────────────────────────────────────────────────
    section('EDGE CASES');
    const DUP = await req('POST', '/workgant/api/auth/users', { email: 'editor@test.com', password: 'xyz123', role: 'viewer' }, SA);
    ok('Create duplicate email (expect 409)', DUP.status === 409);

    const SHORT = await req('POST', '/workgant/api/auth/users', { email: 'short@test.com', password: '123', role: 'viewer' }, SA);
    ok('Create user short password (expect 400)', SHORT.status === 400);

    const NOAUTH = await req('GET', '/workgant/api/categories', null, null);
    ok('Request without token (expect 401)', NOAUTH.status === 401);

    const BADTOKEN = await req('GET', '/workgant/api/categories', null, 'invalid.token.here');
    ok('Request with invalid token (expect 401)', BADTOKEN.status === 401);

    // ── LOGS ─────────────────────────────────────────────────────────────────
    section('LOGS');
    const today = new Date().toISOString().slice(0, 10);

    const LA = await req('GET', '/workgant/api/auth/logs?date=' + today, null, SA);
    ok('Logs API superadmin', LA.status === 200, Array.isArray(LA.body) ? LA.body.length + ' entries' : LA.body);

    const LF = await req('GET', '/workgant/api/auth/logs?date=' + today + '&action=create_user', null, SA);
    ok('Logs filter by action', LF.status === 200, LF.body.length + ' create_user entries');

    const LFU = await req('GET', '/workgant/api/auth/logs?date=' + today + '&user=gal', null, SA);
    ok('Logs filter by user', LFU.status === 200, LFU.body.length + ' entries for user=gal');

    const LE = await req('GET', '/workgant/api/auth/logs?date=' + today, null, ET);
    ok('Editor access logs (expect 403)', LE.status === 403);

    const LV = await req('GET', '/workgant/api/auth/logs?date=' + today, null, VT);
    ok('Viewer access logs (expect 403)', LV.status === 403);

    const LD = await req('GET', '/workgant/api/auth/logs/dates', null, SA);
    ok('Log dates list', LD.status === 200, JSON.stringify(LD.body));

    const logFile = path.join(__dirname, 'logs', today + '.log');
    const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    ok('Log file written to disk', lines.length > 0, lines.length + ' entries');

    // ── CLEANUP ──────────────────────────────────────────────────────────────
    console.log('\n=== CLEANUP ===');
    await req('DELETE', '/workgant/api/gantts/' + ganttId, null, SA);
    if (ganttId2) await req('DELETE', '/workgant/api/gantts/' + ganttId2, null, SA);
    await req('DELETE', '/workgant/api/categories/' + catId, null, SA);

    const allUsers = (await req('GET', '/workgant/api/auth/users', null, SA)).body;
    for (const u of allUsers.filter(u => u.email.endsWith('@test.com'))) {
      await req('DELETE', '/workgant/api/auth/users/' + u.id, null, SA);
      console.log('   Deleted:', u.email);
    }

  } finally {
    const endTime = Date.now();

    // ── Export HTML report ────────────────────────────────────────────────
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const reportDir = path.join(__dirname, 'test-reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportPath = path.join(reportDir, `report-${timestamp}.html`);
    fs.writeFileSync(reportPath, generateReport(startTime, endTime), 'utf8');

    console.log(`\n📊 Report: test-reports/report-${timestamp}.html`);
    console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed}/${results.length} passed`);

    serverProc.kill();
  }
}

// ── HTML report generator ─────────────────────────────────────────────────────
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
        <td class="icon">${r.passed ? '✅' : '❌'}</td>
        <td class="label">${r.label}</td>
        <td class="extra">${r.extra ? r.extra : '—'}</td>
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
        <thead><tr><th style="width:40px"></th><th>בדיקה</th><th>פרטים</th></tr></thead>
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
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f1f5f9; }
    th { padding: 10px 16px; font-size: 12px; color: #64748b; font-weight: 600; text-align: right; border-bottom: 1px solid #e2e8f0; }
    td { padding: 11px 16px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }
    tr.fail { background: #fff5f5; }
    td.icon { width: 40px; text-align: center; font-size: 16px; }
    td.extra { color: #64748b; font-size: 13px; font-family: monospace; }
    .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
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
