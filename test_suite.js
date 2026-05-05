process.env.TEST_MODE = '1';
const http = require('http');
const db   = require('./db');

function req(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ hostname: 'localhost', port: 3011, path, method, headers }, res => {
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

function ok(label, cond, extra) {
  console.log((cond ? '✅' : '❌') + ' ' + label + (extra ? ' — ' + extra : ''));
}

async function otpLogin(email) {
  await req('POST', '/workgant/api/auth/otp/request', { email });
  const row = db.prepare(
    `SELECT code FROM otp_codes WHERE email=? COLLATE NOCASE AND used=0 ORDER BY id DESC LIMIT 1`
  ).get(email);
  if (!row) return null;
  const res = await req('POST', '/workgant/api/auth/otp/verify', { email, code: row.code });
  return res.status === 200 ? res.body.token : null;
}

async function run() {
  // cleanup leftovers from previous run
  db.prepare(`DELETE FROM users WHERE email LIKE '%@test.com'`).run();

  // ── AUTH ──────────────────────────────────────────────────────────────────
  console.log('\n=== AUTH ===');
  const SA = await otpLogin('gal@finitione.com');
  ok('Login superadmin via OTP', !!SA, SA ? 'token ok' : 'no token');
  if (!SA) { console.log('ABORT: no token'); process.exit(1); }

  const LM = await req('POST', '/workgant/api/auth/otp/request', {});
  ok('OTP request missing email (expect 400)', LM.status === 400);

  const LU = await req('POST', '/workgant/api/auth/otp/verify', { email: 'noexist@test.com', code: '000000' });
  ok('OTP verify nonexistent user (expect 401 or 400)', LU.status === 400 || LU.status === 401);

  const BADOTP = await req('POST', '/workgant/api/auth/otp/verify', { email: 'gal@finitione.com', code: '000000' });
  ok('OTP verify wrong code (expect 401)', BADOTP.status === 401);

  // ── VIEWER ────────────────────────────────────────────────────────────────
  console.log('\n=== VIEWER ===');
  const CV = await req('POST', '/workgant/api/auth/users', { email: 'viewer@test.com', password: 'viewer123', role: 'viewer', gantt_ids: [1] }, SA);
  ok('Create viewer', CV.status === 200, 'id=' + CV.body.id);
  const VT = await otpLogin('viewer@test.com');
  ok('Viewer login via OTP', !!VT);

  const VG = await req('GET', '/workgant/api/gantts/1', null, VT);
  ok('Viewer GET permitted gantt', VG.status === 200);

  const VG2 = await req('GET', '/workgant/api/gantts/2', null, VT);
  ok('Viewer GET non-permitted gantt (expect 403)', VG2.status === 403);

  const VS = await req('PATCH', '/workgant/api/gantts/1/state', {}, VT);
  ok('Viewer PATCH state (expect 403)', VS.status === 403);

  const VC = await req('POST', '/workgant/api/gantts', { category_id: 1, name: 'x', type: 'annual', year: 2026 }, VT);
  ok('Viewer CREATE gantt (expect 403)', VC.status === 403);

  const VCats = await req('GET', '/workgant/api/categories', null, VT);
  const visibleGantts = Array.isArray(VCats.body) ? VCats.body.flatMap(c => c.gantts || []).map(g => g.id) : [];
  ok('Viewer sees only permitted gantts', JSON.stringify(visibleGantts) === '[1]', JSON.stringify(visibleGantts));

  // ── EDITOR ────────────────────────────────────────────────────────────────
  console.log('\n=== EDITOR ===');
  const CE = await req('POST', '/workgant/api/auth/users', { email: 'editor@test.com', password: 'editor123', role: 'editor', gantt_ids: [1] }, SA);
  ok('Create editor', CE.status === 200, 'id=' + CE.body.id);
  const ET = await otpLogin('editor@test.com');
  ok('Editor login via OTP', !!ET);

  const EG = await req('GET', '/workgant/api/gantts/1', null, ET);
  ok('Editor GET permitted gantt', EG.status === 200);

  const EG2 = await req('GET', '/workgant/api/gantts/2', null, ET);
  ok('Editor GET non-permitted gantt (expect 403)', EG2.status === 403);

  const ES = await req('PATCH', '/workgant/api/gantts/1/state', {}, ET);
  ok('Editor PATCH state permitted gantt', ES.status === 200);

  const ED = await req('DELETE', '/workgant/api/gantts/1', null, ET);
  ok('Editor DELETE gantt (expect 403)', ED.status === 403);

  const ECC = await req('POST', '/workgant/api/categories', { name: 'חדש', type: 'annual' }, ET);
  ok('Editor CREATE category (expect 403)', ECC.status === 403);

  const EGC = await req('POST', '/workgant/api/gantts', { category_id: 1, name: 'גאנט עורך', type: 'annual', year: 2026 }, ET);
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

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  console.log('\n=== ADMIN ===');
  const CA = await req('POST', '/workgant/api/auth/users', { email: 'admin@test.com', password: 'admin123', role: 'admin' }, SA);
  ok('Create admin', CA.status === 200, 'id=' + CA.body.id);
  const AT = await otpLogin('admin@test.com');
  ok('Admin login via OTP', !!AT);

  const AGantts = await req('GET', '/workgant/api/gantts/1', null, AT);
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

  // ── EDGE CASES ────────────────────────────────────────────────────────────
  console.log('\n=== EDGE CASES ===');
  const DUP = await req('POST', '/workgant/api/auth/users', { email: 'editor@test.com', password: 'xyz123', role: 'viewer' }, SA);
  ok('Create duplicate email (expect 409)', DUP.status === 409);

  const SHORT = await req('POST', '/workgant/api/auth/users', { email: 'short@test.com', password: '123', role: 'viewer' }, SA);
  ok('Create user short password (expect 400)', SHORT.status === 400);

  const NOAUTH = await req('GET', '/workgant/api/categories', null, null);
  ok('Request without token (expect 401)', NOAUTH.status === 401);

  const BADTOKEN = await req('GET', '/workgant/api/categories', null, 'invalid.token.here');
  ok('Request with invalid token (expect 401)', BADTOKEN.status === 401);

  // ── LOGS ──────────────────────────────────────────────────────────────────
  console.log('\n=== LOGS ===');
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

  const fs = require('fs'), path = require('path');
  const lf = path.join(__dirname, 'logs', today + '.log');
  const lines = fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8').trim().split('\n').filter(Boolean) : [];
  ok('Log file written to disk', lines.length > 0, lines.length + ' entries');

  // ── CLEANUP ───────────────────────────────────────────────────────────────
  console.log('\n=== CLEANUP ===');
  const allUsers = (await req('GET', '/workgant/api/auth/users', null, SA)).body;
  for (const u of allUsers.filter(u => u.email.endsWith('@test.com'))) {
    await req('DELETE', '/workgant/api/auth/users/' + u.id, null, SA);
    console.log('   Deleted:', u.email);
  }

  console.log('\n✅ Test suite complete');
}

run().catch(e => console.error('FATAL:', e.message));
