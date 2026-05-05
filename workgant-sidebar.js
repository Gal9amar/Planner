(function () {
  const API = '/api';

  const params  = new URLSearchParams(location.search);
  const ganttId = Number(params.get('ganttId')) || null;
  const isIndex = location.pathname.endsWith('index.html') || location.pathname === '/' || location.pathname.endsWith('/workgant/');
  const pageType = location.pathname.includes('annual')  ? 'annual'
                 : location.pathname.includes('monthly') ? 'monthly'
                 : location.pathname.includes('sprint')  ? 'sprint' : null;
  const PAGE_FILE = { annual: 'annual.html', monthly: 'monthly.html', sprint: 'sprint.html' };

  const MENU = [
    { id: 'dashboard', icon: '📊', label: 'דשבורד' },
    { id: 'tasks',     icon: '📋', label: 'תוכנית עבודה' },
    { id: 'manpower',  icon: '👥', label: 'כוח אדם' },
    { id: 'resources', icon: '⏱️', label: 'חלוקת משאבים' },
    { id: 'sprints',   icon: '🔄', label: 'ספרינטים' },
    { id: 'settings',  icon: '⚙️', label: 'הגדרות גאנט' },
    { id: 'help',      icon: 'ℹ️', label: 'עזרה' },
  ];

  // ── Auth ──────────────────────────────────────────────────────────────────
  const LS_TOKEN = 'wg_access_token';
  const LS_USER  = 'wg_user';

  let _token = localStorage.getItem(LS_TOKEN) || '';
  let _user  = (() => { try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); } catch { return null; } })();

  function saveSession(token, user) {
    _token = token;
    _user  = user;
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_USER,  JSON.stringify(user));
  }

  function clearSession() {
    _token = '';
    _user  = null;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
  }

  async function authFetch(url, opts = {}) {
    opts.headers = opts.headers || {};
    if (_token) opts.headers['Authorization'] = `Bearer ${_token}`;
    const res = await fetch(url, opts);
    if (res.status === 401) {
      clearSession();
      showLoginModal();
      throw new Error('session_expired');
    }
    return res;
  }

  // expose globally for use by sprint.html / monthly.html / annual.html
  window.wgAuth = { authFetch, getUser: () => _user };

  // ── Login Modal (OTP flow) ────────────────────────────────────────────────
  function showLoginModal(message) {
    let modal = document.getElementById('wg-login-modal');
    if (modal) {
      // אפס לשלב 1
      // עצור טיימר קיים
      if (modal._otpTimer) { clearInterval(modal._otpTimer); modal._otpTimer = null; }
      // אפס לשלב 1
      const step1 = modal.querySelector('#wglm-step1');
      const step2 = modal.querySelector('#wglm-step2');
      if (step1) step1.style.display = 'block';
      if (step2) step2.style.display = 'none';
      const emailInp = modal.querySelector('#wglm-email');
      if (emailInp) { emailInp.value = ''; setTimeout(() => emailInp.focus(), 50); }
      const err1 = modal.querySelector('#wglm-err1');
      if (err1) err1.textContent = message || '';
      const btn1 = modal.querySelector('#wglm-btn1');
      if (btn1) { btn1.disabled = false; btn1.textContent = 'שלח קוד כניסה'; }
      modal.style.display = 'flex';
      return;
    }

    const el = document.createElement('div');
    el.id = 'wg-login-modal';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.6);backdrop-filter:blur(8px);direction:rtl;font-family:Heebo,system-ui,sans-serif;';
    el.innerHTML = `
      <div style="background:#fff;border-radius:24px;padding:40px;width:380px;max-width:92vw;box-shadow:0 24px 80px rgba(0,0,0,0.22);text-align:center;">
        <div style="width:56px;height:56px;background:linear-gradient(135deg,#0ea5e9,#6366f1);border-radius:16px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18M7 14l4-4 4 4 5-6"/></svg>
        </div>
        <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin:0 0 4px;">Planner</h2>
        <p style="font-size:13px;color:#64748b;margin:0 0 28px;">ניהול גאנטים פנימי</p>

        <!-- שלב 1: מייל -->
        <div id="wglm-step1">
          <form id="wglm-form1" autocomplete="on">
            <input id="wglm-email" type="email" placeholder="כתובת מייל" autocomplete="username"
              style="width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:10px;padding:11px 14px;font-size:14px;font-family:inherit;margin-bottom:14px;outline:none;direction:ltr;text-align:right;color:#0f172a;background:#f8fafc;" />
            <div id="wglm-err1" style="min-height:18px;color:#ef4444;font-size:12px;margin-bottom:8px;"></div>
            <button type="submit" id="wglm-btn1"
              style="width:100%;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;">
              שלח קוד כניסה
            </button>
          </form>
        </div>

        <!-- שלב 2: קוד OTP -->
        <div id="wglm-step2" style="display:none;">
          <p id="wglm-step2-desc" style="font-size:13px;color:#475569;margin:0 0 20px;line-height:1.6;"></p>

          <!-- שדות הקוד — 6 תיבות -->
          <div id="wglm-otp-boxes" style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;direction:ltr;">
            ${Array.from({length:6},(_,i)=>`<input data-otp-idx="${i}" type="text" inputmode="numeric" maxlength="1"
              style="width:44px;height:52px;border:2px solid #e2e8f0;border-radius:10px;text-align:center;font-size:22px;font-weight:700;color:#0f172a;font-family:monospace;outline:none;background:#f8fafc;transition:border-color .15s;" />`).join('')}
          </div>

          <!-- טיימר -->
          <div id="wglm-timer-wrap" style="margin-bottom:16px;">
            <span id="wglm-timer" style="font-size:13px;color:#64748b;">הקוד תקף עוד <strong id="wglm-timer-val">1:00</strong></span>
            <button id="wglm-resend" style="display:none;background:none;border:none;color:#6366f1;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;text-decoration:underline;">שלח קוד מחדש</button>
          </div>

          <div id="wglm-err2" style="min-height:18px;color:#ef4444;font-size:12px;margin-bottom:8px;"></div>
          <button id="wglm-btn2"
            style="width:100%;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;opacity:.5;cursor:not-allowed;">
            כניסה
          </button>
          <button id="wglm-back" style="margin-top:10px;background:none;border:none;color:#94a3b8;font-size:12px;font-family:inherit;cursor:pointer;">← חזרה</button>
        </div>

        <div id="wglm-err" style="display:none;"></div>
      </div>`;
    document.body.appendChild(el);

    let _otpTimerInterval = null;
    let _currentEmail = '';
    el._otpTimer = null; // exposed for reset from outside

    const step1     = el.querySelector('#wglm-step1');
    const step2     = el.querySelector('#wglm-step2');
    const form1     = el.querySelector('#wglm-form1');
    const emailInp  = el.querySelector('#wglm-email');
    const err1      = el.querySelector('#wglm-err1');
    const btn1      = el.querySelector('#wglm-btn1');
    const step2desc = el.querySelector('#wglm-step2-desc');
    const otpBoxes  = Array.from(el.querySelectorAll('[data-otp-idx]'));
    const timerWrap = el.querySelector('#wglm-timer-wrap');
    const timerEl   = el.querySelector('#wglm-timer');
    const timerVal  = el.querySelector('#wglm-timer-val');
    const resendBtn = el.querySelector('#wglm-resend');
    const err2      = el.querySelector('#wglm-err2');
    const btn2      = el.querySelector('#wglm-btn2');
    const backBtn   = el.querySelector('#wglm-back');

    function getOtpValue() { return otpBoxes.map(b => b.value).join(''); }

    function updateBtn2State() {
      const ready = getOtpValue().length === 6;
      btn2.style.opacity = ready ? '1' : '.5';
      btn2.style.cursor  = ready ? 'pointer' : 'not-allowed';
    }

    function startTimer(seconds) {
      clearInterval(_otpTimerInterval);
      el._otpTimer = null;
      timerWrap.style.display = '';
      timerEl.style.display  = 'inline';
      resendBtn.style.display = 'none';
      let left = seconds;
      function tick() {
        const m = Math.floor(left / 60);
        const s = left % 60;
        timerVal.textContent = m + ':' + String(s).padStart(2,'0');
        if (left <= 0) {
          clearInterval(_otpTimerInterval);
          timerEl.style.display  = 'none';
          resendBtn.style.display = 'inline';
        }
        left--;
      }
      tick();
      _otpTimerInterval = setInterval(tick, 1000);
      el._otpTimer = _otpTimerInterval;
    }

    // OTP box navigation
    otpBoxes.forEach((box, i) => {
      box.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g,'');
        e.target.value = val.slice(-1);
        if (val && i < 5) otpBoxes[i+1].focus();
        updateBtn2State();
        err2.textContent = '';
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) { otpBoxes[i-1].focus(); otpBoxes[i-1].value = ''; updateBtn2State(); }
        if (e.key === 'Enter') { e.preventDefault(); if (getOtpValue().length === 6) submitOtp(); }
      });
      box.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
        text.split('').forEach((ch, j) => { if (otpBoxes[j]) otpBoxes[j].value = ch; });
        if (text.length > 0) otpBoxes[Math.min(text.length, 5)].focus();
        updateBtn2State();
      });
      box.addEventListener('focus', () => { box.style.borderColor = '#6366f1'; });
      box.addEventListener('blur',  () => { box.style.borderColor = box.value ? '#6366f1' : '#e2e8f0'; });
    });

    async function requestOtp(email) {
      btn1.disabled = true;
      btn1.textContent = 'שולח...';
      err1.textContent = '';
      try {
        const r = await fetch(`${API}/auth/otp/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const body = await r.json();
        if (!r.ok) {
          err1.textContent = body.message || 'שגיאה בשליחת הקוד';
          btn1.disabled = false;
          btn1.textContent = 'שלח קוד כניסה';
          return;
        }
        // עבור לשלב 2
        _currentEmail = email;
        step1.style.display = 'none';
        step2.style.display = 'block';
        const maskedDomain = email.split('@')[1];
        step2desc.innerHTML = `קוד כניסה נשלח ל-<strong>${esc(email.slice(0,2))}***@${esc(maskedDomain)}</strong>.<br>הזן את הקוד בן 6 הספרות:`;
        otpBoxes.forEach(b => { b.value = ''; b.style.borderColor = '#e2e8f0'; });
        err2.textContent = '';
        updateBtn2State();
        startTimer(120);
        setTimeout(() => otpBoxes[0].focus(), 50);
      } catch {
        err1.textContent = 'שגיאת חיבור לשרת';
        btn1.disabled = false;
        btn1.textContent = 'שלח קוד כניסה';
      }
    }

    async function submitOtp() {
      const code = getOtpValue();
      if (code.length !== 6) return;
      btn2.disabled = true;
      const origText = btn2.textContent;
      btn2.textContent = 'מאמת...';
      err2.textContent = '';
      try {
        const r = await fetch(`${API}/auth/otp/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: _currentEmail, code }),
        });
        const body = await r.json();
        if (!r.ok) {
          otpBoxes.forEach(b => { b.style.borderColor = '#ef4444'; b.value = ''; });
          updateBtn2State();
          err2.textContent = body.message || 'קוד שגוי, נסה שוב';
          if (body.error === 'account_locked') {
            // חסום — הסתר טיימר ו"שלח שוב", נטרל כניסה
            clearInterval(_otpTimerInterval);
            timerWrap.style.display = 'none';
            btn2.disabled = true;
          } else {
            otpBoxes[0].focus();
            btn2.disabled = false;
          }
          btn2.textContent = origText;
          return;
        }
        clearInterval(_otpTimerInterval);
        saveSession(body.token, body.user);
        el.style.display = 'none';
        renderProfile();
        loadCategories();
        if (isIndex) {
          const frame = document.getElementById('gantt-frame');
          if (frame && frame.contentWindow && frame.contentWindow.__wgOnLogin) frame.contentWindow.__wgOnLogin();
        } else {
          window.__wgOnLogin && window.__wgOnLogin();
        }
      } catch {
        err2.textContent = 'שגיאת חיבור לשרת';
        btn2.disabled = false;
        btn2.textContent = origText;
      }
    }

    form1.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInp.value.trim();
      if (!email) { err1.textContent = 'יש להזין כתובת מייל'; return; }
      await requestOtp(email);
    });

    btn2.addEventListener('click', submitOtp);

    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      resendBtn.textContent = 'שולח...';
      err2.textContent = '';
      try {
        await fetch(`${API}/auth/otp/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: _currentEmail }),
        });
      } catch {}
      otpBoxes.forEach(b => { b.value = ''; b.style.borderColor = '#e2e8f0'; });
      updateBtn2State();
      startTimer(120);
      resendBtn.disabled = false;
      resendBtn.textContent = 'שלח קוד מחדש';
      otpBoxes[0].focus();
    });

    backBtn.addEventListener('click', () => {
      clearInterval(_otpTimerInterval);
      step2.style.display = 'none';
      step1.style.display = 'block';
      btn1.disabled = false;
      btn1.textContent = 'שלח קוד כניסה';
      err1.textContent = '';
    });

    if (message) err1.textContent = message;
  }

  // ── Profile widget ────────────────────────────────────────────────────────
  function renderProfile() {
    const el = document.getElementById('wgsb-profile');
    if (!el) return;
    if (!_user) {
      el.innerHTML = `<button onclick="window._wgsb.showLogin()" style="width:100%;background:none;border:none;cursor:pointer;font-family:inherit;padding:10px 16px;border-radius:12px;color:#6366f1;font-size:13px;font-weight:700;text-align:right;transition:background .15s;" onmouseenter="this.style.background='rgba(99,102,241,0.08)'" onmouseleave="this.style.background='none'">
        <span style="margin-left:6px;">🔑</span> כניסה
      </button>`;
      return;
    }
    const initials = (_user.email || '?').slice(0,2).toUpperCase();
    el.innerHTML = `
      <div style="border-top:1px solid rgba(148,163,184,0.18);padding:12px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;border-radius:0 0 24px 24px;transition:background .15s;" onclick="window._wgsb.openProfile()" onmouseenter="this.style.background='rgba(99,102,241,0.06)'" onmouseleave="this.style.background='none'">
        <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#0ea5e9);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:800;flex-shrink:0;">${initials}</div>
        <div style="flex:1;overflow:hidden;">
          <div style="font-size:13px;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(_user.email)}</div>
          <div style="font-size:11px;color:#94a3b8;">${_user.role === 'superadmin' ? 'מנהל מערכת ראשי' : _user.role === 'admin' ? 'מנהל' : _user.role === 'editor' ? 'עורך' : 'צופה'}</div>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </div>`;
  }

  // ── פתיחת מסך פרופיל / ניהול משתמשים בתוך אזור התוכן הראשי ────────────────
  async function showProfileScreen(tab) {
    // הסתר iframe ו-welcome, הצג את מסך הפרופיל
    const screen  = document.getElementById('wg-profile-screen');
    const frame   = document.getElementById('gantt-frame');
    const welcome = document.getElementById('gantt-welcome');
    if (!screen) return; // לא index.html — אין מסך
    if (frame)   frame.style.display   = 'none';
    if (welcome) welcome.style.display = 'none';
    screen.style.display = 'block';
    renderProfileScreen(tab || 'profile');
  }

  function hideProfileScreen() {
    const screen  = document.getElementById('wg-profile-screen');
    const welcome = document.getElementById('gantt-welcome');
    if (!screen) return;
    screen.style.display = 'none';
    // החזר welcome אם אין gantt פתוח
    const frame = document.getElementById('gantt-frame');
    if (!frame || frame.src === 'about:blank' || !frame.src) {
      if (welcome) welcome.style.display = 'flex';
    } else {
      if (frame) frame.style.display = 'block';
    }
  }

  async function renderProfileScreen(tab) {
    const screen  = document.getElementById('wg-profile-screen');
    if (!screen) return;
    const isSuperAdmin = _user?.role === 'superadmin';
    const isAdmin = _user?.role === 'admin' || isSuperAdmin;
    const initials = (_user?.email || '?').slice(0,2).toUpperCase();
    const activeTab = tab || 'profile';
    const isEditor = _user?.role === 'editor';
    const roleLabel = isSuperAdmin ? 'מנהל מערכת ראשי' : isAdmin ? 'מנהל' : isEditor ? 'עורך' : 'צופה';

    screen.innerHTML = `
      <div style="max-width:720px;margin:0 auto;">
        <!-- כותרת -->
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:32px;">
          <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#0ea5e9);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:800;flex-shrink:0;">${initials}</div>
          <div style="flex:1;">
            <div style="font-size:22px;font-weight:900;color:#0f172a;">${esc(_user?.email||'')}</div>
            <div style="font-size:13px;color:#64748b;margin-top:2px;">${roleLabel}</div>
          </div>
          <button onclick="window._wgsb.closeProfileScreen()" style="background:rgba(100,116,139,0.1);border:none;border-radius:12px;padding:8px 16px;font-size:13px;font-weight:700;color:#64748b;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            חזרה
          </button>
        </div>

        <!-- טאבים -->
        <div style="display:flex;gap:4px;margin-bottom:24px;background:rgba(241,245,249,0.8);border-radius:14px;padding:4px;">
          <button onclick="window._wgsb.switchProfileTab('profile')" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;${activeTab==='profile'?'background:#fff;color:#6366f1;box-shadow:0 2px 8px rgba(0,0,0,0.08);':'background:none;color:#64748b;'}">פרופיל</button>
          ${isAdmin ? `<button onclick="window._wgsb.switchProfileTab('users')" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;${activeTab==='users'?'background:#fff;color:#6366f1;box-shadow:0 2px 8px rgba(0,0,0,0.08);':'background:none;color:#64748b;'}">משתמשים</button>` : ''}
          ${isSuperAdmin ? `<button onclick="window._wgsb.switchProfileTab('settings')" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;${activeTab==='settings'?'background:#fff;color:#6366f1;box-shadow:0 2px 8px rgba(0,0,0,0.08);':'background:none;color:#64748b;'}">הגדרות</button>` : ''}
          ${isSuperAdmin ? `<button onclick="window._wgsb.switchProfileTab('locked')" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;${activeTab==='locked'?'background:#fff;color:#ef4444;box-shadow:0 2px 8px rgba(0,0,0,0.08);':'background:none;color:#64748b;'}">נעולים</button>` : ''}
          ${isSuperAdmin ? `<button onclick="window._wgsb.switchProfileTab('logs')" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;${activeTab==='logs'?'background:#fff;color:#6366f1;box-shadow:0 2px 8px rgba(0,0,0,0.08);':'background:none;color:#64748b;'}">לוגים</button>` : ''}
          ${isSuperAdmin ? `<button onclick="window._wgsb.switchProfileTab('testruns')" style="flex:1;padding:9px;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .15s;${activeTab==='testruns'?'background:#fff;color:#6366f1;box-shadow:0 2px 8px rgba(0,0,0,0.08);':'background:none;color:#64748b;'}">בדיקות</button>` : ''}
        </div>

        <!-- תוכן טאב פרופיל -->
        <div id="wgps-tab-profile" style="display:${activeTab==='profile'?'block':'none'};">
          <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);border-radius:20px;padding:28px;margin-bottom:16px;">
            ${isSuperAdmin ? `
            <h3 style="font-size:13px;font-weight:800;color:#94a3b8;margin:0 0 16px;text-transform:uppercase;letter-spacing:.06em;">עריכת פרטי חשבון</h3>
            <form id="wgps-me-form">
              <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:5px;">כתובת מייל</label>
              <input id="wgps-me-email" type="email" value="${esc(_user?.email||'')}" autocomplete="username"
                style="width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:10px;padding:10px 13px;font-size:14px;font-family:inherit;margin-bottom:14px;outline:none;direction:ltr;text-align:right;background:#f8fafc;" />
              <div id="wgps-me-err" style="min-height:16px;color:#ef4444;font-size:12px;margin-bottom:8px;"></div>
              <div id="wgps-me-ok" style="color:#10b981;font-size:13px;margin-bottom:8px;display:none;font-weight:700;">✓ הפרטים עודכנו בהצלחה</div>
              <button type="submit" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:10px;padding:10px 24px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">שמור שינויים</button>
            </form>
            <div style="border-top:1px solid #e2e8f0;margin:24px 0;"></div>
            ` : ''}
          </div>
          <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);border:1px solid rgba(239,68,68,0.2);border-radius:20px;padding:22px 28px;display:flex;align-items:center;justify-content:space-between;">
            <div>
              <div style="font-size:14px;font-weight:700;color:#0f172a;">התנתקות</div>
              <div style="font-size:12px;color:#94a3b8;margin-top:2px;">תצא מהמערכת ותחזור למסך ההתחברות</div>
            </div>
            <button onclick="window._wgsb.logout()" style="display:inline-flex;align-items:center;gap:8px;background:rgba(239,68,68,0.06);border:1.5px solid rgba(239,68,68,0.2);color:#ef4444;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              התנתקות
            </button>
          </div>
        </div>

        <!-- תוכן טאב הגדרות -->
        ${isSuperAdmin ? `
        <div id="wgps-tab-settings" style="display:${activeTab==='settings'?'block':'none'};">
          <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);border-radius:20px;padding:24px;">
            <h3 style="font-size:13px;font-weight:800;color:#94a3b8;margin:0 0 16px;text-transform:uppercase;letter-spacing:.06em;">בדיקת שליחת מייל</h3>
            <p style="font-size:13px;color:#64748b;margin:0 0 14px;">בדוק שהגדרות ה-SMTP פועלות תקין על-ידי שליחת מייל בדיקה.</p>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input id="wgps-test-mail-to" type="email" placeholder="מייל יעד" value="${esc(_user?.email||'')}"
                style="flex:1;min-width:180px;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;font-family:inherit;outline:none;direction:ltr;text-align:right;background:#f8fafc;box-sizing:border-box;" />
              <button id="wgps-test-mail-btn" onclick="window._wgsb.sendTestMail()"
                style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap;">
                שלח מייל בדיקה
              </button>
            </div>
            <div id="wgps-test-mail-status" style="min-height:16px;font-size:13px;margin-top:10px;"></div>
          </div>
        </div>` : ''}

        <!-- תוכן טאב נעולים -->
        ${isSuperAdmin ? `
        <div id="wgps-tab-locked" style="display:${activeTab==='locked'?'block':'none'};">
          <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);border-radius:20px;overflow:hidden;">
            <div style="padding:16px 24px;border-bottom:1px solid #f1f5f9;background:rgba(248,250,252,0.8);display:flex;align-items:center;justify-content:space-between;">
              <div style="font-size:13px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">חשבונות נעולים</div>
              <button onclick="window._wgsb.loadLockedAccounts()" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">רענן</button>
            </div>
            <div id="wgps-locked-list" style="padding:0;">
              <div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">טוען...</div>
            </div>
          </div>
        </div>` : ''}

        <!-- תוכן טאב לוגים -->
        ${isSuperAdmin ? `
        <div id="wgps-tab-logs" style="display:${activeTab==='logs'?'block':'none'};">
          <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);border-radius:20px;padding:20px 24px;">
            <h3 style="font-size:13px;font-weight:800;color:#94a3b8;margin:0 0 14px;text-transform:uppercase;letter-spacing:.06em;">לוגי מערכת</h3>
            <!-- סינון -->
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
              <input id="wglogs-date" type="date" value="${new Date().toISOString().slice(0,10)}"
                style="border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;outline:none;background:#f8fafc;" />
              <input id="wglogs-user" type="text" placeholder="סינון לפי משתמש"
                style="flex:1;min-width:140px;border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;outline:none;background:#f8fafc;" />
              <select id="wglogs-action" style="border:1.5px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;font-family:inherit;outline:none;background:#f8fafc;">
                <option value="">כל הפעולות</option>
                <option value="create_gantt">יצירת גאנט</option>
                <option value="save_gantt">שמירת גאנט</option>
                <option value="rename_gantt">שינוי שם גאנט</option>
                <option value="delete_gantt">מחיקת גאנט</option>
                <option value="create_user">יצירת משתמש</option>
                <option value="update_user">עדכון משתמש</option>
                <option value="delete_user">מחיקת משתמש</option>
                <option value="error">שגיאות</option>
              </select>
              <button onclick="window._wgsb.loadLogs()" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;">טען</button>
            </div>
            <div id="wglogs-status" style="font-size:12px;color:#64748b;margin-bottom:8px;min-height:16px;"></div>
            <div id="wglogs-table-wrap" style="overflow-x:auto;">
              <div style="font-size:13px;color:#94a3b8;text-align:center;padding:20px;">בחר תאריך ולחץ טען</div>
            </div>
          </div>
        </div>` : ''}

        <!-- תוכן טאב בדיקות אוטומציה -->
        ${isSuperAdmin ? `
        <div id="wgps-tab-testruns" style="display:${activeTab==='testruns'?'block':'none'};">
          <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);border-radius:20px;padding:20px 24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
              <h3 style="font-size:13px;font-weight:800;color:#94a3b8;margin:0;text-transform:uppercase;letter-spacing:.06em;">בדיקות אוטומציה</h3>
              <button id="wgtr-run-btn" onclick="window._wgRunTests()" style="background:#6366f1;color:#fff;border:none;border-radius:10px;padding:8px 18px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;transition:opacity .15s;">▶ הרץ בדיקות</button>
            </div>

            <!-- פס התקדמות -->
            <div id="wgtr-progress-wrap" style="display:none;margin-bottom:16px;">
              <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:6px;">
                <span id="wgtr-progress-label">מריץ בדיקות...</span>
                <span id="wgtr-progress-count"></span>
              </div>
              <div style="background:#e2e8f0;border-radius:99px;height:8px;overflow:hidden;">
                <div id="wgtr-progress-bar" style="height:100%;background:#6366f1;width:0%;transition:width .3s;border-radius:99px;"></div>
              </div>
              <div id="wgtr-last-test" style="font-size:11px;color:#94a3b8;margin-top:6px;min-height:16px;direction:rtl;"></div>
            </div>

            <!-- טבלת הרצות -->
            <div id="wgtr-table-wrap" style="overflow-x:auto;">
              <div style="font-size:13px;color:#94a3b8;text-align:center;padding:20px;">טוען...</div>
            </div>
          </div>
        </div>` : ''}

        <!-- תוכן טאב ניהול משתמשים -->
        ${isAdmin ? `
        <div id="wgps-tab-users" style="display:${activeTab==='users'?'block':'none'};">
          <div style="background:rgba(255,255,255,0.7);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.6);border-radius:20px;overflow:hidden;">
            <!-- הוספת משתמש -->
            <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:rgba(248,250,252,0.8);">
              <div style="font-size:13px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px;">הוספת משתמש חדש</div>
              <form id="wgps-add-form">
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
                  <div style="flex:2;min-width:160px;">
                    <label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:4px;">מייל</label>
                    <input id="wgps-add-email" type="email" placeholder="user@example.com" style="width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit;outline:none;direction:ltr;text-align:right;background:#fff;" />
                  </div>
                  <div style="flex:1;min-width:120px;">
                    <label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:4px;">סיסמה</label>
                    <input id="wgps-add-pass" type="text" placeholder="סיסמה" style="width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit;outline:none;direction:ltr;text-align:right;background:#fff;" onblur="(function(el){var err=document.getElementById('wgps-add-err');if(el.value&&el.value.length<6){el.style.borderColor='#ef4444';if(err)err.textContent='סיסמה חייבת להכיל לפחות 6 תווים';}else{el.style.borderColor='';if(err&&err.textContent==='סיסמה חייבת להכיל לפחות 6 תווים')err.textContent='';}})(this)" />
                  </div>
                  <div style="min-width:110px;">
                    <label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:4px;">תפקיד</label>
                    <select id="wgps-add-role" onchange="window._wgsb.onAddRoleChange()" style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit;outline:none;background:#fff;">
                      <option value="viewer">צופה</option>
                      <option value="editor">עורך</option>
                      <option value="admin">מנהל</option>
                    </select>
                  </div>
                  <button type="submit" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;white-space:nowrap;align-self:flex-end;">+ הוסף</button>
                </div>
                <!-- הרשאות גאנטים לצופה/עורך -->
                <div id="wgps-add-perms" style="margin-top:12px;display:block;">
                  <label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:6px;">הרשאות גאנטים</label>
                  <div id="wgps-add-gantt-list" style="display:flex;flex-wrap:wrap;gap:6px;">
                    <span style="font-size:12px;color:#94a3b8;">טוען...</span>
                  </div>
                </div>
              </form>
              <div id="wgps-add-err" style="min-height:14px;color:#ef4444;font-size:12px;margin-top:6px;"></div>
            </div>
            <!-- רשימת משתמשים -->
            <div id="wgps-users-list">
              <div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">טוען...</div>
            </div>
          </div>
        </div>` : ''}
      </div>`;

    // ── event handlers ──

    // Admin self-edit
    const meForm = screen.querySelector('#wgps-me-form');
    if (meForm) {
      meForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = screen.querySelector('#wgps-me-err');
        const okEl  = screen.querySelector('#wgps-me-ok');
        errEl.textContent = ''; okEl.style.display = 'none';
        const newEmail = screen.querySelector('#wgps-me-email').value.trim();
        const body = {};
        if (newEmail && newEmail !== _user?.email) body.email = newEmail;
        if (!Object.keys(body).length) { errEl.textContent = 'לא בוצעו שינויים'; return; }
        try {
          const r = await authFetch(`${API}/auth/me`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const b = await r.json();
          if (!r.ok) { errEl.textContent = b.message || 'שגיאה בעדכון'; return; }
          if (b.token) saveSession(b.token, b.user);
          screen.querySelector('#wgps-me-email').value = _user?.email || '';
          okEl.style.display = 'block';
          renderProfile();
        } catch { errEl.textContent = 'שגיאת חיבור'; }
      });
    }

    // Add user form
    const addForm = screen.querySelector('#wgps-add-form');
    if (addForm) {
      // populate gantt checkboxes for new user
      await loadGanttPermissionsUI('wgps-add-gantt-list', [], []);

      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = screen.querySelector('#wgps-add-err');
        errEl.textContent = '';
        const email = screen.querySelector('#wgps-add-email').value.trim();
        const pass  = screen.querySelector('#wgps-add-pass').value;
        const role  = screen.querySelector('#wgps-add-role').value;
        if (!email || !pass) { errEl.textContent = 'יש למלא מייל וסיסמה'; return; }
        const needsPerms   = role === 'viewer' || role === 'editor';
        const gantt_ids    = needsPerms ? getCheckedGanttIds('wgps-add-gantt-list')    : [];
        const category_ids = needsPerms ? getCheckedCategoryIds('wgps-add-gantt-list') : [];
        try {
          const r = await authFetch(`${API}/auth/users`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass, role, gantt_ids, category_ids }),
          });
          const b = await r.json();
          if (!r.ok) { errEl.textContent = b.message || b.error || 'שגיאה ביצירת משתמש'; return; }
          screen.querySelector('#wgps-add-email').value = '';
          screen.querySelector('#wgps-add-pass').value  = '';
          await loadUsersInScreen();
        } catch { errEl.textContent = 'שגיאת חיבור'; }
      });
      await loadUsersInScreen();
    }

    // auto-load locked accounts tab
    if (activeTab === 'locked') {
      await window._wgsb.loadLockedAccounts();
    }

    // auto-load test runs tab
    if (activeTab === 'testruns') {
      await window._wgsb.loadTestRuns();
    }
  }

  function roleBadge(role) {
    if (role === 'superadmin') return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;background:rgba(139,92,246,0.12);color:#7c3aed;">מנהל ראשי</span>`;
    if (role === 'admin')      return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;background:rgba(99,102,241,0.12);color:#4338ca;">מנהל</span>`;
    if (role === 'editor')     return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;background:rgba(245,158,11,0.12);color:#b45309;">עורך</span>`;
    return `<span style="font-size:11px;padding:2px 8px;border-radius:6px;font-weight:700;background:rgba(14,165,233,0.12);color:#0369a1;">צופה</span>`;
  }

  async function loadUsersInScreen() {
    const listEl = document.getElementById('wgps-users-list');
    if (!listEl) return;
    try {
      const r = await authFetch(`${API}/auth/users`);
      const users = await r.json();
      // also fetch all gantts for display
      const gr = await authFetch(`${API}/categories`);
      const cats = gr.ok ? await gr.json() : [];
      const allGantts = cats.flatMap(c => (c.gantts || []).map(g => ({ ...g, catName: c.name })));

      listEl.innerHTML = users.map(u => {
        const isSelf = u.id === _user?.id;
        const isSA   = u.role === 'superadmin';
        const canEdit = !isSelf && !isSA;
        const catTags = (u.category_ids || []).map(cid => {
          const c = cats.find(c => c.id === cid);
          return c ? `<span style="font-size:10px;padding:1px 8px;border-radius:4px;background:rgba(99,102,241,0.1);color:#4338ca;font-weight:700;">${esc(c.name)} ★</span>` : '';
        }).join('');
        const ganttNames = (u.gantt_ids || []).map(gid => {
          const g = allGantts.find(g => g.id === gid);
          return g ? `<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:#f1f5f9;color:#475569;">${esc(g.name)}</span>` : '';
        }).join('');

        return `
        <div style="padding:14px 24px;border-bottom:1px solid #f1f5f9;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:38px;height:38px;border-radius:50%;background:${isSA?'linear-gradient(135deg,#8b5cf6,#6366f1)':u.role==='admin'?'linear-gradient(135deg,#6366f1,#0ea5e9)':'linear-gradient(135deg,#0ea5e9,#10b981)'};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:800;flex-shrink:0;">${u.email.slice(0,2).toUpperCase()}</div>
            <div style="flex:1;overflow:hidden;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="font-size:14px;font-weight:700;color:${u.is_active?'#0f172a':'#94a3b8'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.email)}</span>
                ${roleBadge(u.role)}
              </div>
              <div style="font-size:11px;color:#94a3b8;margin-top:1px;">נוצר ${u.created_at?u.created_at.slice(0,10):''}</div>
            </div>
            <span style="font-size:11px;padding:3px 9px;border-radius:6px;font-weight:700;flex-shrink:0;${u.is_active?'background:#ecfdf5;color:#047857':'background:#f1f5f9;color:#94a3b8'}">${u.is_active?'פעיל':'מושבת'}</span>
            ${canEdit ? `
            <button onclick="window._wgsb.editUser(${u.id},'${esc(u.email)}','${u.role}',${u.is_active},${JSON.stringify(u.gantt_ids||[])},${JSON.stringify(u.category_ids||[])})" style="background:rgba(99,102,241,0.08);border:1.5px solid rgba(99,102,241,0.2);color:#6366f1;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">ערוך</button>
            <button onclick="window._wgsb.resendWelcome(${u.id},'${esc(u.email)}')" title="שלח מייל הצטרפות" style="background:rgba(14,165,233,0.08);border:1.5px solid rgba(14,165,233,0.2);color:#0ea5e9;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">✉️</button>
            <button onclick="window._wgsb.toggleUser(${u.id},${u.is_active})" style="background:${u.is_active?'rgba(239,68,68,0.08)':'rgba(16,185,129,0.08)'};border:1.5px solid ${u.is_active?'rgba(239,68,68,0.2)':'rgba(16,185,129,0.2)'};color:${u.is_active?'#ef4444':'#10b981'};border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">${u.is_active?'השבת':'הפעל'}</button>
            <button onclick="window._wgsb.deleteUser(${u.id},'${esc(u.email)}')" style="background:rgba(239,68,68,0.08);border:1.5px solid rgba(239,68,68,0.2);color:#ef4444;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">מחק</button>
            ` : `<span style="font-size:11px;color:#94a3b8;">(אתה)</span>`}
          </div>
          ${(u.role==='viewer'||u.role==='editor') && (catTags||ganttNames) ? `<div style="margin-top:6px;padding-right:50px;display:flex;flex-wrap:wrap;gap:4px;">${catTags}${ganttNames}</div>` : ''}
        </div>`;
      }).join('');
    } catch (err) {
      if (err.message !== 'session_expired') listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;font-size:13px;">שגיאה בטעינת המשתמשים</div>';
    }
  }

  // helper: dropdown multiselect הרשאות גאנטים
  async function loadGanttPermissionsUI(containerId, selectedGanttIds, selectedCatIds) {
    selectedGanttIds = selectedGanttIds || [];
    selectedCatIds   = selectedCatIds   || [];
    const wrapper = document.getElementById(containerId);
    if (!wrapper) return;
    try {
      const r = await authFetch(`${API}/categories`);
      if (!r.ok) { wrapper.innerHTML = '<span style="font-size:12px;color:#ef4444;">שגיאה בטעינת גאנטים</span>'; return; }
      const cats = await r.json();
      if (!cats.length) { wrapper.innerHTML = '<span style="font-size:12px;color:#94a3b8;">אין גאנטים במערכת</span>'; return; }

      // build flat list of options: category rows + gantt rows
      // stored on the wrapper so getChecked* can read them
      wrapper._catsData = cats;
      wrapper._selGanttIds = [...selectedGanttIds];
      wrapper._selCatIds   = [...selectedCatIds];

      const tagsId   = containerId + '-tags';
      const menuId   = containerId + '-menu';

      wrapper.style.cssText = 'position:relative;width:100%;';
      wrapper.innerHTML = `
        <div id="${tagsId}" onclick="window._wgpOpenMenu(event,'${containerId}')"
          style="min-height:36px;border:1.5px solid #e2e8f0;border-radius:8px;padding:4px 8px;cursor:pointer;display:flex;flex-wrap:wrap;gap:4px;align-items:center;background:#fff;user-select:none;">
          <span class="wgp-placeholder" style="font-size:12px;color:#94a3b8;">בחר בורדים / גאנטים...</span>
        </div>
        <div id="${menuId}" style="display:none;position:fixed;z-index:999999;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.18);max-height:220px;overflow-y:auto;direction:rtl;min-width:260px;">
          ${cats.map(cat => `
            <div style="border-bottom:1px solid #f1f5f9;">
              <div onclick="window._wgpToggleCat(event,'${containerId}',${cat.id})" data-cat-id="${cat.id}"
                style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;background:#f8fafc;font-size:12px;font-weight:800;color:#1e293b;"
                onmouseenter="this.style.background='#f1f5f9'" onmouseleave="this.style.background='#f8fafc'">
                <span style="font-size:10px;color:#6366f1;border:1.5px solid #c7d2fe;border-radius:4px;padding:1px 5px;font-weight:700;">בורד</span>
                ${esc(cat.name)}
              </div>
              ${(cat.gantts||[]).map(g => `
                <div onclick="window._wgpToggleGantt(event,'${containerId}',${g.id})" data-gantt-id="${g.id}"
                  style="display:flex;align-items:center;gap:8px;padding:6px 12px 6px 24px;cursor:pointer;font-size:12px;font-weight:600;color:#475569;"
                  onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background='transparent'">
                  <span style="width:7px;height:7px;border-radius:50%;background:#0ea5e9;flex-shrink:0;display:inline-block;"></span>
                  ${esc(g.name)}
                </div>`).join('')}
            </div>`).join('')}
        </div>`;

      // close on outside click (register once)
      if (!window._wgpOutsideHandler) {
        window._wgpOutsideHandler = (e) => {
          document.querySelectorAll('[id$="-menu"]').forEach(m => {
            if (m.style.display !== 'block') return;
            const tagsEl = document.getElementById(m.id.replace('-menu', '-tags'));
            if (!tagsEl?.contains(e.target) && !m.contains(e.target))
              m.style.display = 'none';
          });
        };
        document.addEventListener('click', window._wgpOutsideHandler);
      }

      _wgpRefreshTags(containerId, cats);
    } catch { wrapper.innerHTML = '<span style="font-size:12px;color:#ef4444;">שגיאת חיבור</span>'; }
  }

  function _wgpRefreshTags(containerId, cats) {
    const wrapper  = document.getElementById(containerId);
    if (!wrapper) return;
    const tagsEl   = document.getElementById(containerId + '-tags');
    const menuEl   = document.getElementById(containerId + '-menu');
    if (!tagsEl) return;
    cats = cats || wrapper._catsData || [];
    const selCats  = wrapper._selCatIds   || [];
    const selGants = wrapper._selGanttIds || [];

    const tags = [];
    selCats.forEach(cid => {
      const c = cats.find(c => c.id === cid);
      if (c) tags.push({ label: c.name + ' ★', type: 'cat', id: cid });
    });
    selGants.forEach(gid => {
      for (const c of cats) {
        const g = (c.gantts||[]).find(g => g.id === gid);
        if (g) { tags.push({ label: g.name, type: 'gantt', id: gid }); break; }
      }
    });

    if (!tags.length) {
      tagsEl.innerHTML = '<span class="wgp-placeholder" style="font-size:12px;color:#94a3b8;">בחר בורדים / גאנטים...</span>';
    } else {
      tagsEl.innerHTML = tags.map(t => `
        <span style="display:inline-flex;align-items:center;gap:4px;background:${t.type==='cat'?'rgba(99,102,241,0.1)':'rgba(14,165,233,0.1)'};color:${t.type==='cat'?'#4338ca':'#0369a1'};border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700;">
          ${esc(t.label)}
          <span onclick="event.stopPropagation();window._wgpRemove('${containerId}','${t.type}',${t.id})" style="cursor:pointer;font-size:12px;line-height:1;opacity:.7;">✕</span>
        </span>`).join('');
    }

    // highlight selected rows in menu
    if (menuEl) {
      menuEl.querySelectorAll('[data-cat-id]').forEach(row => {
        const cid = Number(row.dataset.catId);
        row.style.background = selCats.includes(cid) ? 'rgba(99,102,241,0.08)' : '#f8fafc';
        row.style.color      = selCats.includes(cid) ? '#4338ca' : '#1e293b';
      });
      menuEl.querySelectorAll('[data-gantt-id]').forEach(row => {
        const gid = Number(row.dataset.ganttId);
        row.style.background = selGants.includes(gid) ? 'rgba(14,165,233,0.08)' : 'transparent';
        row.style.color      = selGants.includes(gid) ? '#0369a1' : '#475569';
      });
    }
  }

  window._wgpOpenMenu = function(e, containerId) {
    e.stopPropagation();
    const tagsEl = document.getElementById(containerId + '-tags');
    if (!tagsEl) return;
    // move menu to body to escape any overflow/transform context
    let menuEl = document.getElementById(containerId + '-menu');
    if (!menuEl) return;
    if (menuEl.parentElement !== document.body) document.body.appendChild(menuEl);
    if (menuEl.style.display === 'block') { menuEl.style.display = 'none'; return; }
    const rect = tagsEl.getBoundingClientRect();
    menuEl.style.top    = (rect.bottom + 4) + 'px';
    menuEl.style.right  = (window.innerWidth - rect.right) + 'px';
    menuEl.style.left   = 'auto';
    menuEl.style.width  = rect.width + 'px';
    menuEl.style.display = 'block';
  };

  window._wgpToggleCat = function(e, containerId, catId) {
    e.stopPropagation();
    const wrapper = document.getElementById(containerId);
    if (!wrapper) return;
    const idx = wrapper._selCatIds.indexOf(catId);
    if (idx === -1) wrapper._selCatIds.push(catId);
    else wrapper._selCatIds.splice(idx, 1);
    _wgpRefreshTags(containerId);
  };

  window._wgpToggleGantt = function(e, containerId, ganttId) {
    e.stopPropagation();
    const wrapper = document.getElementById(containerId);
    if (!wrapper) return;
    const idx = wrapper._selGanttIds.indexOf(ganttId);
    if (idx === -1) wrapper._selGanttIds.push(ganttId);
    else wrapper._selGanttIds.splice(idx, 1);
    _wgpRefreshTags(containerId);
  };

  window._wgpRemove = function(containerId, type, id) {
    const wrapper = document.getElementById(containerId);
    if (!wrapper) return;
    if (type === 'cat') wrapper._selCatIds   = wrapper._selCatIds.filter(x => x !== id);
    else                wrapper._selGanttIds = wrapper._selGanttIds.filter(x => x !== id);
    _wgpRefreshTags(containerId);
  };

  function getCheckedGanttIds(containerId) {
    const wrapper = document.getElementById(containerId);
    return (wrapper?._selGanttIds || []).map(Number);
  }

  function getCheckedCategoryIds(containerId) {
    const wrapper = document.getElementById(containerId);
    return (wrapper?._selCatIds || []).map(Number);
  }

  /* ── CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    /* Sidebar shell */
    #wg-sidebar-root {
      width: 320px; min-width: 320px; flex-shrink: 0;
      height: calc(100vh - 10px);
      max-height: calc(100vh - 10px);
      align-self: flex-start;
      position: relative;
      border-radius: 24px;
      overflow: hidden;
      display: flex; flex-direction: column;
      margin: 5px 12px 12px 12px;
      box-shadow:
        0 4px 24px rgba(0,0,0,0.06),
        0 12px 48px -12px rgba(99,102,241,0.12),
        inset 0 1px 0 rgba(255,255,255,0.5);
      border: 1px solid rgba(255,255,255,0.4);
      border-left: 1px solid rgba(99,102,241,0.25);
      font-family: 'Heebo', system-ui, sans-serif;
      direction: rtl;
    }
    #wgsb-glass {
      position: absolute; inset: 0;
      background: linear-gradient(165deg,
        rgba(255,255,255,0.72) 0%,
        rgba(248,250,252,0.68) 50%,
        rgba(241,245,249,0.7) 100%);
      backdrop-filter: blur(24px) saturate(160%);
      -webkit-backdrop-filter: blur(24px) saturate(160%);
      border-radius: 24px;
      pointer-events: none;
      z-index: 0;
    }
    #wgsb-inner {
      position: relative; z-index: 1;
      display: flex; flex-direction: column;
      height: 100%; width: 100%; overflow: hidden;
    }

    /* Header */
    .wgsb-header {
      padding: 20px 20px 14px;
      border-bottom: 1px solid rgba(148,163,184,0.18);
      flex-shrink: 0;
      text-align: center;
    }
    .wgsb-logo { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 14px; }
    .wgsb-logo-icon {
      width: 38px; height: 38px;
      background: linear-gradient(135deg,#0ea5e9,#6366f1);
      border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      box-shadow: 0 2px 10px rgba(99,102,241,0.3);
    }
    .wgsb-logo-icon svg { width: 20px; height: 20px; color: white; }
    .wgsb-logo-text { font-size: 20px; font-weight: 900; color: #1e293b; letter-spacing: .01em; }
    .wgsb-logo-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
    .wgsb-new-btn {
      width: 100%; display: flex; align-items: center; justify-content: center; gap: 7px;
      padding: 10px 12px; border-radius: 12px; border: none;
      background: linear-gradient(135deg,#6366f1,#8b5cf6);
      color: #fff; font-size: 13px; font-weight: 700;
      font-family: inherit; cursor: pointer;
      box-shadow: 0 2px 12px rgba(99,102,241,0.35);
      transition: opacity .15s, box-shadow .15s;
    }
    .wgsb-new-btn:hover { opacity: .9; box-shadow: 0 4px 18px rgba(99,102,241,0.45); }

    /* Section label */
    .wgsb-section-label {
      font-size: 11px; font-weight: 700; color: #94a3b8;
      text-transform: uppercase; letter-spacing: .08em;
      padding: 10px 16px 6px;
    }

    /* Scroll area */
    .wgsb-scroll { flex: 1; overflow-y: auto; padding: 6px 12px 10px; }
    .wgsb-scroll::-webkit-scrollbar { display: none; }

    /* Category */
    .wgsb-cat-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-radius: 12px;
      cursor: pointer; user-select: none; margin-bottom: 2px;
      background: rgba(241,245,249,0.85);
      border: 1px solid rgba(148,163,184,0.12);
      transition: background .15s;
    }
    .wgsb-cat-header:hover { background: rgba(226,232,240,0.95); }
    .wgsb-cat-chevron { color: #94a3b8; font-size: 11px; transition: transform .15s; flex-shrink: 0; }
    .wgsb-cat-chevron.open { transform: rotate(180deg); }
    .wgsb-cat-name { flex: 1; font-size: 14px; font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wgsb-cat-actions { display: flex; gap: 2px; }
    .wgsb-cat-actions button { background: rgba(148,163,184,0.12); border: none; cursor: pointer; color: #94a3b8; padding: 2px 7px; border-radius: 6px; font-size: 12px; transition: all .12s; }
    .wgsb-cat-actions button:hover { color: #6366f1; background: rgba(99,102,241,0.15); }
    .wgsb-cat-actions button.btn-delete { color: #ef4444; background: rgba(239,68,68,0.1); }
    .wgsb-cat-actions button.btn-delete:hover { color: #dc2626; background: rgba(239,68,68,0.2); }

    /* Gantt items */
    .wgsb-gantt-list { padding-right: 8px; margin-bottom: 6px; margin-top: 3px; }
    .wgsb-gantt-item {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 14px; border-radius: 10px;
      cursor: pointer; margin-bottom: 2px;
      border: 1px solid transparent;
      transition: all .15s;
      color: #475569;
    }
    .wgsb-gantt-item:hover { background: rgba(99,102,241,0.06); color: #1e293b; }
    .wgsb-gantt-item.open {
      background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08));
      border-color: rgba(99,102,241,0.25); color: #6366f1;
    }
    .wgsb-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .wgsb-dot.annual  { background: #0ea5e9; }
    .wgsb-dot.monthly { background: #10b981; }
    .wgsb-dot.sprint  { background: #f59e0b; }
    .wgsb-gantt-name { flex: 1; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .wgsb-gantt-badge { font-size: 10px; padding: 2px 6px; border-radius: 6px; font-weight: 700; flex-shrink: 0; }
    .wgsb-gantt-badge.annual  { background: rgba(14,165,233,.12); color: #0369a1; }
    .wgsb-gantt-badge.monthly { background: rgba(16,185,129,.12); color: #047857; }
    .wgsb-gantt-badge.sprint  { background: rgba(245,158,11,.12);  color: #b45309; }
    .wgsb-gantt-actions { display: flex; gap: 2px; }
    .wgsb-gantt-actions button { background: rgba(239,68,68,0.1); border: none; cursor: pointer; color: #ef4444; padding: 2px 7px; border-radius: 6px; font-size: 11px; transition: all .12s; }
    .wgsb-gantt-actions button:hover { color: #dc2626; background: rgba(239,68,68,0.2); }

    /* Sub-menu (screens inside a gantt) */
    .wgsb-menu { padding-right: 20px; padding-bottom: 4px; }
    .wgsb-menu-item {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 14px; border-radius: 10px;
      cursor: pointer; font-size: 14px; font-weight: 600;
      color: #64748b; margin-bottom: 2px;
      border: 1px solid transparent;
      transition: all .15s; user-select: none;
    }
    .wgsb-menu-item:hover { background: rgba(99,102,241,0.06); color: #1e293b; }
    .wgsb-menu-item.active {
      background: linear-gradient(135deg, rgba(199,210,254,0.35), rgba(224,231,255,0.3));
      border-color: rgba(99,102,241,0.35); color: #6366f1;
    }
    .wgsb-menu-icon { font-size: 14px; width: 20px; text-align: center; flex-shrink: 0; }

    /* Add gantt link */
    .wgsb-add-gantt {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 14px; border-radius: 10px; cursor: pointer;
      color: #94a3b8; font-size: 12px; font-weight: 600; margin-top: 3px;
      border: none; background: none; width: 100%; text-align: right;
      font-family: inherit; transition: all .15s;
    }
    .wgsb-add-gantt:hover { background: rgba(99,102,241,0.06); color: #6366f1; }
    @keyframes wgLogFade { from { opacity: 0; background: rgba(99,102,241,0.08); } to { opacity: 1; } }
  `;
  document.head.appendChild(style);

  /* ── state ── */
  let categories = [];
  let collapsed = {};
  let openGanttId = ganttId; // on gantt pages: current gantt is open by default
  let currentSection = getCurrentSection();

  function getCurrentSection() {
    if (!pageType) return null;
    const stored = localStorage.getItem('wg_' + pageType + '_screen');
    return stored || 'dashboard';
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;');
  }

  /* ── render ── */
  function render() {
    const list = document.getElementById('wgsb-list');
    if (!list) return;
    const isViewer = _user?.role === 'viewer';
    const isEditor = _user?.role === 'editor';

    if (!categories.length) {
      list.innerHTML = '<div style="padding:20px 16px;color:#94a3b8;font-size:12px;text-align:center;line-height:1.6;">אין בורדים עדיין<br><span style="font-size:11px;opacity:.7;">לחץ על "בורד חדש" להתחלה</span></div>';
      return;
    }

    list.innerHTML = categories.map(cat => {
      const isOpen = !collapsed[cat.id];

      const ganttsHtml = cat.gantts.map(g => {
        const isThisOpen = g.id === openGanttId;

        const menuHtml = isThisOpen ? `
          <div class="wgsb-menu">
            ${MENU.map(m => {
              const isActive = isThisOpen && currentSection === m.id;
              return `<div class="wgsb-menu-item${isActive ? ' active' : ''}" onclick="window._wgsb.selectSection('${m.id}', ${g.id}, '${g.type}')">
                <span class="wgsb-menu-icon">${m.icon}</span>${m.label}
              </div>`;
            }).join('')}
          </div>
        ` : '';

        return `
          <div>
            <div class="wgsb-gantt-item${isThisOpen ? ' open' : ''}" onclick="window._wgsb.toggleGantt(${g.id}, '${g.type}')">
              <span class="wgsb-dot ${g.type}"></span>
              <span class="wgsb-gantt-name">${esc(g.name)}</span>
              <span class="wgsb-gantt-badge ${g.type}">${g.type === 'annual' ? 'שנתי' : g.type === 'monthly' ? 'חודשי' : 'ספרינט'}</span>
              ${(!isViewer && !isEditor) ? `<span class="wgsb-gantt-actions">
                <button onclick="event.stopPropagation(); window._wgsb.deleteGantt(${g.id}, '${esc(g.name)}')" title="מחק"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
              </span>` : ''}
            </div>
            ${menuHtml}
          </div>`;
      }).join('');

      return `
        <div>
          <div class="wgsb-cat-header" onclick="window._wgsb.toggleCat(${cat.id})">
            <span class="wgsb-cat-chevron${isOpen ? ' open' : ''}">▾</span>
            <span style="font-size:14px">📋</span>
            <span class="wgsb-cat-name">${esc(cat.name)}</span>
            ${!isViewer ? `<span class="wgsb-cat-actions">
              <button onclick="event.stopPropagation(); window._wgsb.renameCat(${cat.id}, '${esc(cat.name)}')" title="שנה שם">✎</button>
              <button class="btn-delete" onclick="event.stopPropagation(); window._wgsb.deleteCat(${cat.id})" title="מחק"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
            </span>` : ''}
          </div>
          <div style="${isOpen ? '' : 'display:none'}; padding-right:12px; margin-bottom:4px;">
            ${ganttsHtml}
            ${!isViewer ? `<button class="wgsb-add-gantt" onclick="window._wgsb.newGantt(${cat.id})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              גאנט חדש
            </button>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  /* ── iframe loader (index only) ── */
  function loadFrame(url) {
    const frame   = document.getElementById('gantt-frame');
    const welcome = document.getElementById('gantt-welcome');
    const profile = document.getElementById('wg-profile-screen');
    if (!frame || !welcome) return;
    if (profile) profile.style.display = 'none';
    if (!url) {
      frame.style.display = 'none';
      frame.src = 'about:blank';
      welcome.style.display = 'flex';
    } else {
      welcome.style.display = 'none';
      frame.style.display = 'block';
      frame.src = url;
    }
  }

  async function loadCategories() {
    try {
      const r = await authFetch(API + '/categories');
      if (!r.ok) return;
      const data = await r.json();
      categories = data;
      if (ganttId) {
        const cat = categories.find(c => c.gantts.some(g => g.id === ganttId));
        if (cat) collapsed[cat.id] = false;
      }
      // hide/show new board button based on role
      const btn = document.getElementById('wgsb-new-cat-btn');
      if (btn) btn.style.display = _user?.role === 'viewer' ? 'none' : '';
      render();
    } catch (err) {
      if (err.message !== 'session_expired') {
        const list = document.getElementById('wgsb-list');
        if (list) list.innerHTML = '<div style="padding:16px;color:#ef4444;font-size:12px;text-align:center;">שגיאת חיבור לשרת</div>';
      }
    }
  }

  /* ── actions ── */
  window._wgsb = {
    toggleCat(catId) {
      collapsed[catId] = !collapsed[catId];
      render();
    },

    toggleGantt(id, type) {
      // סגור מסך פרופיל אם פתוח
      const ps = document.getElementById('wg-profile-screen');
      if (ps) ps.style.display = 'none';

      if (isIndex) {
        if (openGanttId === id) {
          openGanttId = null;
          currentSection = 'dashboard';
          loadFrame(null);
        } else {
          openGanttId = id;
          currentSection = localStorage.getItem('wg_' + type + '_screen') || 'dashboard';
          loadFrame(`/${PAGE_FILE[type]}?ganttId=${id}`);
        }
        render();
        return;
      }
      if (id === ganttId) {
        openGanttId = openGanttId === id ? null : id;
        render();
      } else {
        window.location.href = `/${PAGE_FILE[type]}?ganttId=${id}`;
      }
    },

    selectSection(sectionId, gId, type) {
      if (isIndex) {
        const frame = document.getElementById('gantt-frame');
        // סגור מסך פרופיל אם פתוח
        const ps = document.getElementById('wg-profile-screen');
        if (ps) ps.style.display = 'none';
        currentSection = sectionId;
        openGanttId = gId;
        if (frame && frame.contentWindow && frame.contentWindow.__wgSetScreen) {
          // iframe טעון ומוכן — עדכן section ישירות
          frame.contentWindow.__wgSetScreen(sectionId);
          frame.style.display = 'block';
          const welcome = document.getElementById('gantt-welcome');
          if (welcome) welcome.style.display = 'none';
        } else {
          // iframe לא טעון או מסך פרופיל כיסה אותו — כתוב section ל-localStorage וטען
          localStorage.setItem(`wg_${type}_screen`, sectionId);
          const url = `/${PAGE_FILE[type]}?ganttId=${gId}`;
          const welcome = document.getElementById('gantt-welcome');
          if (welcome) welcome.style.display = 'none';
          if (frame) {
            frame.style.display = 'block';
            frame.src = url;
          }
        }
        render();
        return;
      }
      currentSection = sectionId;
      localStorage.setItem('wg_' + pageType + '_screen', sectionId);
      window.__wgSetScreen && window.__wgSetScreen(sectionId);
      render();
    },

    async newGantt(catId) {
      window._wgsb_newGantt && window._wgsb_newGantt(catId);
    },

    async renameCat(catId, name) {
      window._wgsb_renameCat && window._wgsb_renameCat(catId, name);
    },

    async deleteCat(catId) {
      window._wgsb_deleteCat && window._wgsb_deleteCat(catId);
    },

    async renameGantt(gId, name) {
      if (window._wgsb_renameGantt) {
        window._wgsb_renameGantt(gId, name);
      } else {
        window.location.href = '/';
      }
    },

    async deleteGantt(gId, name) {
      if (window._wgsb_deleteGantt) {
        window._wgsb_deleteGantt(gId, name);
      } else {
        window.location.href = '/';
      }
    },

    async reload() {
      await loadCategories();
    },

    _openInFrame(id, _type, pageFile, isNew = false) {
      openGanttId = id;
      loadFrame(`/${pageFile}?ganttId=${id}${isNew ? '&new=1' : ''}`);
      render();
    },

    showLogin() { showLoginModal(); },
    openProfile() { showProfileScreen('profile'); },
    openUsersPanel() { showProfileScreen('users'); },
    switchProfileTab(tab) { renderProfileScreen(tab).catch(() => {}); },
    closeProfileScreen() { hideProfileScreen(); },

    async toggleUser(uid, currentActive) {
      try {
        await authFetch(`${API}/auth/users/${uid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: !currentActive }),
        });
        await loadUsersInScreen();
      } catch (e) { if (e.message !== 'session_expired') alert('שגיאה בעדכון המשתמש'); }
    },

    onAddRoleChange() {
      const roleEl  = document.getElementById('wgps-add-role');
      const permsEl = document.getElementById('wgps-add-perms');
      if (!roleEl || !permsEl) return;
      permsEl.style.display = (roleEl.value === 'viewer' || roleEl.value === 'editor') ? 'block' : 'none';
    },

    async editUser(uid, email, role, _isActive, ganttIds, categoryIds) {
      const existing = document.getElementById('wg-edit-user-modal');
      if (existing) existing.remove();

      const isSelf = uid === _user?.id;
      const el = document.createElement('div');
      el.id = 'wg-edit-user-modal';
      el.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.45);backdrop-filter:blur(6px);direction:rtl;font-family:Heebo,system-ui,sans-serif;';
      el.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:28px;width:400px;max-width:94vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.22);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
            <h3 style="font-size:16px;font-weight:800;color:#0f172a;margin:0;flex:1;">ערוך משתמש</h3>
            <button onclick="document.getElementById('wg-edit-user-modal').remove()" style="background:#f1f5f9;border:none;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;color:#64748b;font-family:inherit;">✕</button>
          </div>
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">מייל</label>
          <input id="wgeu-email" type="email" value="${esc(email)}"
            style="width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;font-family:inherit;margin-bottom:12px;outline:none;direction:ltr;text-align:right;background:#f8fafc;" />
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">סיסמה חדשה <span style="font-weight:400;opacity:.6;">(השאר ריק אם לא תרצה לשנות)</span></label>
          <input id="wgeu-pass" type="text" placeholder="סיסמה חדשה"
            style="width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;font-family:inherit;margin-bottom:12px;outline:none;direction:ltr;text-align:right;background:#f8fafc;"
            onblur="(function(el){var err=document.getElementById('wgeu-err');if(el.value&&el.value.length<6){el.style.borderColor='#ef4444';if(err)err.textContent='סיסמה חייבת להכיל לפחות 6 תווים';}else{el.style.borderColor='';if(err&&err.textContent==='סיסמה חייבת להכיל לפחות 6 תווים')err.textContent='';}})(this)" />
          ${!isSelf ? `
          <label style="font-size:12px;font-weight:700;color:#64748b;display:block;margin-bottom:4px;">תפקיד</label>
          <select id="wgeu-role" onchange="window._wgsb.onEditRoleChange()" style="width:100%;box-sizing:border-box;border:1.5px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:14px;font-family:inherit;margin-bottom:12px;outline:none;background:#fff;">
            <option value="viewer"${role==='viewer'?' selected':''}>צופה</option>
            <option value="editor"${role==='editor'?' selected':''}>עורך</option>
            <option value="admin"${role==='admin'?' selected':''}>מנהל</option>
          </select>
          <div id="wgeu-perms" style="margin-bottom:12px;display:${(role==='viewer'||role==='editor')?'block':'none'};">
            <label style="font-size:11px;font-weight:700;color:#94a3b8;display:block;margin-bottom:6px;">הרשאות גאנטים</label>
            <div id="wgeu-gantt-list" style="display:flex;flex-wrap:wrap;gap:4px;">
              <span style="font-size:12px;color:#94a3b8;">טוען...</span>
            </div>
          </div>` : ''}
          <div id="wgeu-err" style="min-height:16px;color:#ef4444;font-size:12px;margin-bottom:8px;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button onclick="document.getElementById('wg-edit-user-modal').remove()" style="background:#f1f5f9;border:none;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;color:#64748b;">ביטול</button>
            <button id="wgeu-save" style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;border:none;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;">שמור</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      el.addEventListener('click', e => { if (e.target === el) el.remove(); });

      // load gantt checkboxes for viewers
      if (!isSelf) {
        await loadGanttPermissionsUI('wgeu-gantt-list', ganttIds || [], categoryIds || []);
      }

      el.querySelector('#wgeu-save').addEventListener('click', async () => {
        const errEl = el.querySelector('#wgeu-err');
        errEl.textContent = '';
        const newEmail = el.querySelector('#wgeu-email').value.trim();
        const newPass  = el.querySelector('#wgeu-pass').value;
        const newRole  = el.querySelector('#wgeu-role')?.value;
        const body = {};
        if (newEmail && newEmail !== email) body.email = newEmail;
        if (newPass) body.password = newPass;
        if (newRole && newRole !== role) body.role = newRole;
        const currentRole = newRole || role;
        if (!isSelf) {
          const needsPerms = currentRole === 'viewer' || currentRole === 'editor';
          body.gantt_ids    = needsPerms ? getCheckedGanttIds('wgeu-gantt-list')    : [];
          body.category_ids = needsPerms ? getCheckedCategoryIds('wgeu-gantt-list') : [];
        } else if (!Object.keys(body).length) {
          el.remove(); return;
        }
        try {
          const isSelfEdit = uid === _user?.id;
          const endpoint = isSelfEdit ? `${API}/auth/me` : `${API}/auth/users/${uid}`;
          const r = await authFetch(endpoint, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const b = await r.json();
          if (!r.ok) { errEl.textContent = b.message || 'שגיאה'; return; }
          if (isSelfEdit && b.token) {
            saveSession(b.token, b.user);
            renderProfile();
          }
          el.remove();
          await loadUsersInScreen();
        } catch (e) { if (e.message !== 'session_expired') errEl.textContent = 'שגיאת חיבור'; }
      });
    },

    onEditRoleChange() {
      const roleEl  = document.getElementById('wgeu-role');
      const permsEl = document.getElementById('wgeu-perms');
      if (!roleEl || !permsEl) return;
      permsEl.style.display = (roleEl.value === 'viewer' || roleEl.value === 'editor') ? 'block' : 'none';
    },

    async deleteUser(uid, email) {
      const result = await Swal.fire({
        title: 'מחיקת משתמש',
        text: `האם למחוק את ${email}? הפעולה בלתי הפיכה.`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'מחק',
        cancelButtonText: 'ביטול',
        reverseButtons: true,
      });
      if (!result.isConfirmed) return;
      try {
        const r = await authFetch(`${API}/auth/users/${uid}`, { method: 'DELETE' });
        if (r.ok) await loadUsersInScreen();
        else { const b = await r.json(); alert(b.message || 'שגיאה במחיקה'); }
      } catch (e) { if (e.message !== 'session_expired') alert('שגיאת חיבור'); }
    },

    async sendTestMail() {
      const input  = document.getElementById('wgps-test-mail-to');
      const status = document.getElementById('wgps-test-mail-status');
      const btn    = document.getElementById('wgps-test-mail-btn');
      if (!input || !status) return;
      const to = input.value.trim();
      if (!to) { status.style.color = '#ef4444'; status.textContent = 'יש להזין כתובת מייל'; return; }
      status.style.color = '#64748b'; status.textContent = 'שולח...';
      if (btn) btn.disabled = true;
      try {
        const r = await authFetch(`${API}/auth/email/test`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to }),
        });
        const b = await r.json();
        if (r.ok) {
          status.style.color = '#10b981';
          status.textContent = `✓ נשלח בהצלחה אל ${to}`;
        } else {
          status.style.color = '#ef4444';
          status.textContent = b.message || 'שגיאה בשליחה';
        }
      } catch (e) {
        if (e.message !== 'session_expired') { status.style.color = '#ef4444'; status.textContent = 'שגיאת חיבור לשרת'; }
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    async resendWelcome(uid, email) {
      const result = await Swal.fire({
        title: 'שלח מייל הצטרפות',
        html: `ישלח מייל הצטרפות עם <strong>סיסמה זמנית חדשה</strong> לכתובת:<br><strong>${esc(email)}</strong>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'שלח',
        cancelButtonText: 'ביטול',
      });
      if (!result.isConfirmed) return;
      try {
        const r = await authFetch(`${API}/auth/users/${uid}/resend-welcome`, { method: 'POST' });
        if (r.ok) {
          Swal.fire({ icon: 'success', title: 'נשלח!', text: `מייל הצטרפות נשלח ל-${email}`, confirmButtonText: 'אישור' });
        } else {
          const b = await r.json();
          Swal.fire({ icon: 'error', title: 'שגיאה', text: b.message || 'שגיאה בשליחת המייל', confirmButtonText: 'אישור' });
        }
      } catch (e) { if (e.message !== 'session_expired') Swal.fire({ icon: 'error', title: 'שגיאת חיבור', confirmButtonText: 'אישור' }); }
    },

    async resetUserPass(uid, email) {
      const newPass = prompt(`סיסמה חדשה עבור ${email}:`);
      if (!newPass || newPass.length < 6) { if (newPass !== null) alert('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
      try {
        const r = await authFetch(`${API}/auth/users/${uid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: newPass }),
        });
        if (r.ok) { alert('הסיסמה עודכנה'); await loadUsersInScreen(); }
        else { const b = await r.json(); alert(b.message || 'שגיאה'); }
      } catch (e) { if (e.message !== 'session_expired') alert('שגיאת חיבור'); }
    },

    async loadLogs() {
      const dateEl   = document.getElementById('wglogs-date');
      const userEl   = document.getElementById('wglogs-user');
      const actionEl = document.getElementById('wglogs-action');
      const wrap     = document.getElementById('wglogs-table-wrap');
      const status   = document.getElementById('wglogs-status');
      if (!dateEl || !wrap) return;

      const date   = dateEl.value;
      const today  = new Date().toISOString().slice(0, 10);
      const isToday = date === today;
      status.textContent = 'טוען...';

      const params = new URLSearchParams({ date });
      if (userEl?.value)   params.set('user',   userEl.value);
      if (actionEl?.value) params.set('action', actionEl.value);

      try {
        const r = await authFetch(`${API}/auth/logs?${params}`);
        const entries = await r.json();
        status.textContent = `${entries.length} רשומות${isToday ? ' (היום — בזמן אמת)' : ''}`;

        if (!entries.length) {
          wrap.innerHTML = '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:20px;">אין רשומות לתצוגה</div>';
        } else {
          const ACTION_HE = {
            create_gantt: 'יצירת גאנט', save_gantt: 'שמירת גאנט', rename_gantt: 'שינוי שם גאנט',
            delete_gantt: 'מחיקת גאנט', create_user: 'יצירת משתמש', update_user: 'עדכון משתמש',
            delete_user: 'מחיקת משתמש', error: 'שגיאה',
          };
          wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
              <th style="padding:8px 10px;text-align:right;font-weight:700;color:#64748b;">זמן</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700;color:#64748b;">משתמש</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700;color:#64748b;">פעולה</th>
              <th style="padding:8px 10px;text-align:right;font-weight:700;color:#64748b;">פרטים</th>
            </tr></thead>
            <tbody>${entries.map(e => {
              const isErr = e.action === 'error';
              const time  = e.timestamp ? e.timestamp.replace('T',' ').slice(0,19) : '';
              const action = ACTION_HE[e.action] || e.action;
              const detail = e.entity_name || e.entity_id || e.details || '';
              const errTxt = e.error ? `<div style="color:#ef4444;font-size:11px;margin-top:2px;word-break:break-all;">${esc(e.error.slice(0,120))}</div>` : '';
              return `<tr style="border-bottom:1px solid #f1f5f9;${isErr?'background:rgba(239,68,68,0.04);':''}">
                <td style="padding:7px 10px;color:#94a3b8;white-space:nowrap;">${esc(time)}</td>
                <td style="padding:7px 10px;color:#475569;">${esc(e.user_email || '—')}</td>
                <td style="padding:7px 10px;"><span style="padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px;background:${isErr?'rgba(239,68,68,0.1)':'rgba(99,102,241,0.08)'};color:${isErr?'#ef4444':'#4338ca'};">${esc(action)}</span></td>
                <td style="padding:7px 10px;color:#475569;">${esc(detail)}${errTxt}</td>
              </tr>`;
            }).join('')}</tbody></table>`;
        }

        // SSE for today
        if (isToday) {
          if (window._wgLogsSSE) { try { window._wgLogsSSE.close(); } catch {} }
          const sse = new EventSource(`${API}/auth/logs/stream?token=${encodeURIComponent(_token)}`);
          window._wgLogsSSE = sse;
          sse.onmessage = (ev) => {
            try {
              const e = JSON.parse(ev.data);
              const ACTION_HE = {
                create_gantt: 'יצירת גאנט', save_gantt: 'שמירת גאנט', rename_gantt: 'שינוי שם גאנט',
                delete_gantt: 'מחיקת גאנט', create_user: 'יצירת משתמש', update_user: 'עדכון משתמש',
                delete_user: 'מחיקת משתמש', error: 'שגיאה',
              };
              const tbody = wrap.querySelector('tbody');
              if (!tbody) return;
              const isErr = e.action === 'error';
              const time  = e.timestamp ? e.timestamp.replace('T',' ').slice(0,19) : '';
              const action = ACTION_HE[e.action] || e.action;
              const detail = e.entity_name || e.entity_id || e.details || '';
              const errTxt = e.error ? `<div style="color:#ef4444;font-size:11px;margin-top:2px;word-break:break-all;">${esc(e.error.slice(0,120))}</div>` : '';
              const row = document.createElement('tr');
              row.style.cssText = `border-bottom:1px solid #f1f5f9;${isErr?'background:rgba(239,68,68,0.04);':''}animation:wgLogFade .4s ease;`;
              row.innerHTML = `
                <td style="padding:7px 10px;color:#94a3b8;white-space:nowrap;">${esc(time)}</td>
                <td style="padding:7px 10px;color:#475569;">${esc(e.user_email || '—')}</td>
                <td style="padding:7px 10px;"><span style="padding:2px 7px;border-radius:5px;font-weight:700;font-size:11px;background:${isErr?'rgba(239,68,68,0.1)':'rgba(99,102,241,0.08)'};color:${isErr?'#ef4444':'#4338ca'};">${esc(action)}</span></td>
                <td style="padding:7px 10px;color:#475569;">${esc(detail)}${errTxt}</td>`;
              tbody.insertBefore(row, tbody.firstChild);
              const cntEl = document.getElementById('wglogs-status');
              if (cntEl) cntEl.textContent = `${tbody.children.length} רשומות (היום — בזמן אמת)`;
            } catch {}
          };
        }
      } catch (e) {
        if (e.message !== 'session_expired') status.textContent = 'שגיאה בטעינת לוגים';
      }
    },

    async loadTestRuns() {
      const wrap = document.getElementById('wgtr-table-wrap');
      if (!wrap) return;
      try {
        const r = await authFetch(`${API}/test-runs`);
        const rows = await r.json();
        if (!rows.length) {
          wrap.innerHTML = '<div style="font-size:13px;color:#94a3b8;text-align:center;padding:20px;">אין הרצות עדיין</div>';
          return;
        }
        wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:8px 10px;text-align:right;font-weight:700;color:#64748b;">#</th>
            <th style="padding:8px 10px;text-align:right;font-weight:700;color:#64748b;">תאריך</th>
            <th style="padding:8px 10px;text-align:right;font-weight:700;color:#64748b;">הריץ</th>
            <th style="padding:8px 10px;text-align:center;font-weight:700;color:#64748b;">עבר/נכשל</th>
            <th style="padding:8px 10px;text-align:center;font-weight:700;color:#64748b;">סטטוס</th>
            <th style="padding:8px 10px;text-align:center;font-weight:700;color:#64748b;">דוח</th>
            <th style="padding:8px 10px;text-align:center;font-weight:700;color:#64748b;"></th>
          </tr></thead>
          <tbody>${rows.map(row => {
            const started = row.started_at
              ? new Date(row.started_at + 'Z').toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
              : '—';
            const statusBadge = row.status === 'passed'
              ? '<span style="background:rgba(16,185,129,0.1);color:#047857;padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px;">✅ עבר</span>'
              : row.status === 'failed'
              ? '<span style="background:rgba(239,68,68,0.1);color:#dc2626;padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px;">❌ נכשל</span>'
              : '<span style="background:rgba(99,102,241,0.1);color:#4338ca;padding:2px 8px;border-radius:5px;font-weight:700;font-size:11px;">⏳ רץ</span>';
            const score = row.total ? `${row.passed}/${row.total}` : '—';
            const reportBtn = row.report_file
              ? `<button onclick="window._wgOpenReport(${row.id})" style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;color:#4338ca;cursor:pointer;font-family:inherit;">פתח</button>`
              : '—';
            const deleteBtn = row.status !== 'running'
              ? `<button onclick="window._wgDeleteRun(${row.id})" style="background:none;border:1px solid #fee2e2;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;color:#dc2626;cursor:pointer;font-family:inherit;" title="מחק הרצה">🗑</button>`
              : '';
            return `<tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:7px 10px;color:#94a3b8;">${row.id}</td>
              <td style="padding:7px 10px;color:#475569;white-space:nowrap;">${esc(started)}</td>
              <td style="padding:7px 10px;color:#475569;">${esc(row.run_by_email || '—')}</td>
              <td style="padding:7px 10px;text-align:center;color:#0f172a;font-weight:700;">${score}</td>
              <td style="padding:7px 10px;text-align:center;">${statusBadge}</td>
              <td style="padding:7px 10px;text-align:center;">${reportBtn}</td>
              <td style="padding:7px 10px;text-align:center;">${deleteBtn}</td>
            </tr>`;
          }).join('')}</tbody></table>`;
      } catch (e) {
        if (e.message !== 'session_expired') wrap.innerHTML = '<div style="font-size:13px;color:#ef4444;text-align:center;padding:20px;">שגיאה בטעינה</div>';
      }
    },

    async loadLockedAccounts() {
      const listEl = document.getElementById('wgps-locked-list');
      if (!listEl) return;
      listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">טוען...</div>';
      try {
        const r = await authFetch(`${API}/auth/locked-accounts`);
        const rows = await r.json();
        if (!rows.length) {
          listEl.innerHTML = '<div style="padding:32px;text-align:center;"><div style="font-size:32px;margin-bottom:10px;">🔓</div><div style="font-size:13px;color:#94a3b8;">אין חשבונות נעולים כרגע</div></div>';
          return;
        }
        listEl.innerHTML = rows.map(row => {
          const remaining = row.remaining_minutes;
          const lockedAt  = (row.locked_at || '').slice(0,16).replace('T',' ');
          return `
          <div style="padding:14px 24px;border-bottom:1px solid #f1f5f9;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#ef4444,#f97316);display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;flex-shrink:0;">🔒</div>
              <div style="flex:1;overflow:hidden;">
                <div style="font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(row.email)}</div>
                <div style="font-size:11px;color:#94a3b8;margin-top:2px;">ננעל: ${esc(lockedAt)} &nbsp;·&nbsp; ${row.attempts} ניסיונות כושלים</div>
              </div>
              <div style="flex-shrink:0;text-align:center;">
                <div style="font-size:13px;font-weight:800;color:#ef4444;">${remaining} דק׳</div>
                <div style="font-size:10px;color:#94a3b8;">נותר</div>
              </div>
              <button onclick="window._wgsb.unlockAccount(${row.id},'${esc(row.email)}')"
                style="flex-shrink:0;background:rgba(16,185,129,0.08);border:1.5px solid rgba(16,185,129,0.25);color:#059669;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;font-family:inherit;cursor:pointer;">
                שחרר
              </button>
            </div>
          </div>`;
        }).join('');
      } catch (e) {
        if (e.message !== 'session_expired')
          listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;font-size:13px;">שגיאה בטעינת הנתונים</div>';
      }
    },

    async unlockAccount(id, email) {
      if (!confirm(`לשחרר את הנעילה של ${email}?`)) return;
      try {
        const r = await authFetch(`${API}/auth/locked-accounts/${id}`, { method: 'DELETE' });
        if (r.ok) {
          await window._wgsb.loadLockedAccounts();
        } else {
          const b = await r.json();
          alert(b.message || 'שגיאה בשחרור הנעילה');
        }
      } catch (e) {
        if (e.message !== 'session_expired') alert('שגיאת חיבור');
      }
    },

    async logout() {
      try { await fetch(`${API}/auth/logout`, { method: 'POST' }); } catch {}
      clearSession();
      const pm = document.getElementById('wg-profile-modal');
      if (pm) pm.style.display = 'none';
      renderProfile();
      showLoginModal();
    },
  };

  /* ── build sidebar HTML and load data ── */
  function init() {
    const root = document.getElementById('wg-sidebar-root');
    if (!root) return false;

    root.innerHTML = `
      <div id="wgsb-glass"></div>
      <div id="wgsb-inner">
        <div class="wgsb-header">
          <div class="wgsb-logo">
            <div class="wgsb-logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 3v18h18M7 14l4-4 4 4 5-6"/>
              </svg>
            </div>
            <div>
              <div class="wgsb-logo-text">Planner</div>
              <div class="wgsb-logo-sub">ניהול גאנטים</div>
            </div>
          </div>
          <button class="wgsb-new-btn" id="wgsb-new-cat-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            בורד חדש
          </button>
        </div>
        <div class="wgsb-section-label">הבורדים שלי</div>
        <div class="wgsb-scroll" id="wgsb-list">
          <div style="padding:16px;color:#94a3b8;font-size:12px;text-align:center;">טוען...</div>
        </div>
        <div id="wgsb-profile"></div>
      </div>
    `;

    const newCatBtn = document.getElementById('wgsb-new-cat-btn');
    newCatBtn.addEventListener('click', () => {
      if (window._wgsb_newCat) {
        window._wgsb_newCat();
      } else {
        window.location.href = '/';
      }
    });

    // render profile widget (or login button)
    renderProfile();
    // hide "בורד חדש" for viewers
    if (_user?.role === 'viewer') newCatBtn.style.display = 'none';

    // if already authenticated, load categories; otherwise show login modal
    if (_token) {
      loadCategories();
    } else {
      showLoginModal();
    }

    return true;
  }

  if (!init()) {
    const observer = new MutationObserver(() => {
      if (init()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Test Runs globals ──────────────────────────────────────────────────────
  window._wgOpenReport = function(runId) {
    window.open(`${API}/test-runs/${runId}/report?token=${encodeURIComponent(_token)}`, '_blank');
  };

  window._wgDeleteRun = async function(runId) {
    if (!confirm('למחוק הרצה זו לצמיתות?')) return;
    try {
      const r = await authFetch(`${API}/test-runs/${runId}`, { method: 'DELETE' });
      if (r.ok) {
        window._wgsb.loadTestRuns();
      } else {
        alert('שגיאה במחיקה');
      }
    } catch { alert('שגיאה במחיקה'); }
  };

  window._wgRunTests = async function() {
    const btn = document.getElementById('wgtr-run-btn');
    const progressWrap = document.getElementById('wgtr-progress-wrap');
    const progressBar  = document.getElementById('wgtr-progress-bar');
    const progressLabel = document.getElementById('wgtr-progress-label');
    const progressCount = document.getElementById('wgtr-progress-count');
    const lastTest     = document.getElementById('wgtr-last-test');
    if (!btn) return;

    btn.disabled = true;
    btn.style.opacity = '0.5';
    if (progressWrap) progressWrap.style.display = 'block';
    if (progressBar)  progressBar.style.width = '0%';
    if (progressLabel) progressLabel.textContent = 'מריץ בדיקות...';
    if (progressCount) progressCount.textContent = '';
    if (lastTest) lastTest.textContent = '';

    try {
      const r = await authFetch(`${API}/test-runs`, { method: 'POST' });
      const { id: runId } = await r.json();

      const sse = new EventSource(`${API}/test-runs/${runId}/progress?token=${encodeURIComponent(_token)}`);
      let totalExpected = 64;

      sse.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'test' || data.type === 'done') {
            const pct = Math.min(100, Math.round((data.total / totalExpected) * 100));
            if (progressBar)  progressBar.style.width = pct + '%';
            if (progressCount) progressCount.textContent = `${data.total}/${totalExpected}`;
            if (lastTest && data.line) lastTest.textContent = data.line.replace(/^[✅❌]\s*/, '');
          }
          if (data.type === 'finish') {
            sse.close();
            const ok = data.status === 'passed';
            if (progressBar) {
              progressBar.style.width = '100%';
              progressBar.style.background = ok ? '#10b981' : '#ef4444';
            }
            if (progressLabel) progressLabel.textContent = ok ? `✅ הסתיים — ${data.passed}/${data.total} עברו` : `❌ נכשל — ${data.failed} כשלו`;
            if (lastTest) lastTest.textContent = '';
            btn.disabled = false;
            btn.style.opacity = '1';
            // רענן טבלה
            window._wgsb.loadTestRuns();
          }
        } catch {}
      };
      sse.onerror = () => {
        sse.close();
        btn.disabled = false;
        btn.style.opacity = '1';
        if (progressLabel) progressLabel.textContent = 'שגיאה בחיבור';
      };
    } catch {
      btn.disabled = false;
      btn.style.opacity = '1';
      if (progressLabel) progressLabel.textContent = 'שגיאה בהפעלה';
    }
  };
})();
