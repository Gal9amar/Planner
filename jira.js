// jira.js — חיבור Jira Cloud דרך OAuth 3LO + סנכרון סטטוסי משימות
// הטוקנים נשמרים ב-data/jira-tokens.json (לא ב-git).
// מבוסס על אותה זרימת OAuth שכבר עובדת ב-jira-qa-track.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');

const ATLASSIAN_AUTH_URL      = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL     = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_ME_URL        = 'https://api.atlassian.com/me';
const ATLASSIAN_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources';

// read:jira-work — קריאת issues; offline_access — refresh token
const SCOPES = 'read:jira-work read:me offline_access';

const TOKEN_FILE = path.join(__dirname, 'data', 'jira-tokens.json');

// ─── Token store ──────────────────────────────────────────────────────────────

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch { /* קובץ פגום — מתייחסים כאילו אין חיבור */ }
  return null;
}

function saveTokens(data) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function clearTokens() {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
}

function isConfigured() {
  return !!(process.env.JIRA_CLIENT_ID && process.env.JIRA_CLIENT_SECRET && process.env.JIRA_REDIRECT_URI);
}

// מחזיר access token תקף, מרענן אוטומטית 5 דק' לפני פקיעה. null = אין חיבור.
async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens) return null;

  const FIVE_MIN = 5 * 60 * 1000;
  if (Date.now() < tokens.expires_at - FIVE_MIN) return tokens.access_token;

  try {
    const res = await axios.post(ATLASSIAN_TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: process.env.JIRA_CLIENT_ID,
      client_secret: process.env.JIRA_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
    });
    const updated = {
      ...tokens,
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + res.data.expires_in * 1000,
    };
    saveTokens(updated);
    console.log('[jira] Token refreshed');
    return updated.access_token;
  } catch (err) {
    console.error('[jira] Refresh failed:', err.response?.data || err.message);
    return null;
  }
}

// ─── Jira API ─────────────────────────────────────────────────────────────────

const MAX_KEYS_PER_BATCH = 100;
// שם השדה בפועל ב-Jira הוא "QA Estimation (hours)" (customfield_10360) — לא "QA Estimate".
const QA_ESTIMATE_FIELD_NAME = 'qa estimation';

function escapeJqlKey(key) {
  return String(key).replace(/["\\]/g, '\\$&');
}

// שמות סטטוס גולמיים מ-Jira שהלקוח (JIRA_STATUS_MAP ב-sprint.html/monthly.html) ממפה ל-'testing' ("בבדיקות").
// אם המיפוי בצד הלקוח משתנה — יש לעדכן גם כאן.
const QA_STATUS_RAW_NAMES = ['qa', 'testing'];

// מוצא את תאריך המעבר האחרון לסטטוס הנוכחי, לפי היסטוריית השינויים של ה-issue ב-Jira.
async function fetchStatusEnteredDate(jiraBase, headers, key, currentStatusName) {
  try {
    let startAt = 0;
    const maxResults = 100;
    let lastMatch = null;
    for (let page = 0; page < 10; page++) {
      const res = await axios.get(`${jiraBase}/rest/api/3/issue/${encodeURIComponent(key)}/changelog`, {
        headers, params: { startAt, maxResults }, timeout: 20000,
      });
      const values = res.data.values || [];
      for (const entry of values) {
        for (const item of entry.items || []) {
          if (item.field === 'status' && String(item.toString || '').trim().toLowerCase() === currentStatusName.trim().toLowerCase()) {
            lastMatch = entry.created;
          }
        }
      }
      if (res.data.isLast !== false || values.length < maxResults) break;
      startAt += maxResults;
    }
    return lastMatch ? String(lastMatch).slice(0, 10) : null;
  } catch {
    return null;
  }
}

// מזהה השדה המותאם "QA Estimation" משתנה בין אתרי Jira — נמצא לפי שם דרך /rest/api/3/field.
// נשמר ב-cache בזיכרון (רק תוצאה חיובית — אם השדה עדיין לא נמצא ננסה שוב בפעם הבאה).
let qaEstimateFieldIdCache = null;

async function resolveQaEstimateFieldId(jiraBase, headers) {
  if (qaEstimateFieldIdCache) return qaEstimateFieldIdCache;
  try {
    const res = await axios.get(`${jiraBase}/rest/api/3/field`, { headers, timeout: 15000 });
    const match = (res.data || []).find(f => String(f.name || '').trim().toLowerCase().includes(QA_ESTIMATE_FIELD_NAME));
    if (match) qaEstimateFieldIdCache = match.id;
    return qaEstimateFieldIdCache;
  } catch {
    return null;
  }
}

/**
 * שולף סטטוס + QA Estimate עדכניים עבור רשימת Issue keys.
 * מחזיר { statuses: { KEY: 'In Dev' }, estimates: { KEY: 5 }, notFound: [KEY, ...] }
 * שמות ה-keys מוחזרים בדיוק כפי ש-Jira מחזיר אותם (uppercase).
 */
async function fetchIssueStatuses(keys) {
  const token = await getValidAccessToken();
  if (!token) {
    const err = new Error('not_connected');
    err.code = 'not_connected';
    throw err;
  }

  const stored = loadTokens();
  const jiraBase = stored.jiraBaseUrl || `https://api.atlassian.com/ex/jira/${stored.cloudId}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  const qaEstimateFieldId = await resolveQaEstimateFieldId(jiraBase, headers);
  const fields = qaEstimateFieldId ? `status,${qaEstimateFieldId}` : 'status';

  const unique = [...new Set(keys.map(k => String(k || '').trim()).filter(Boolean))];
  const statuses = {};
  const estimates = {};

  for (let i = 0; i < unique.length; i += MAX_KEYS_PER_BATCH) {
    const batch = unique.slice(i, i + MAX_KEYS_PER_BATCH);
    const jql = `key IN (${batch.map(k => `"${escapeJqlKey(k)}"`).join(',')})`;

    let nextPageToken = null;
    do {
      const params = { jql, maxResults: MAX_KEYS_PER_BATCH, fields };
      if (nextPageToken) params.nextPageToken = nextPageToken;

      const res = await axios.get(`${jiraBase}/rest/api/3/search/jql`, { headers, params, timeout: 30000 });
      (res.data.issues || []).forEach(issue => {
        const name = issue.fields?.status?.name;
        if (name) statuses[issue.key] = name;
        if (qaEstimateFieldId) {
          const est = issue.fields?.[qaEstimateFieldId];
          if (est !== null && est !== undefined && est !== '') estimates[issue.key] = est;
        }
      });
      nextPageToken = res.data.isLast === false ? res.data.nextPageToken : null;
    } while (nextPageToken);
  }

  // keys שלא חזרו מ-Jira — נמחקו, אין הרשאה, או key שגוי.
  // ההשוואה case-insensitive כי המשתמש עשוי להקליד באותיות קטנות.
  const returnedUpper = new Set(Object.keys(statuses).map(k => k.toUpperCase()));
  const notFound = unique.filter(k => !returnedUpper.has(k.toUpperCase()));

  // עבור משימות שכרגע בסטטוס "בבדיקות" (QA) — שולפים מהיסטוריית ה-issue את תאריך הכניסה בפועל לסטטוס הזה,
  // כדי שיום ההתחלה ישקף מתי זה קרה ב-Jira, לא מתי הופעל הסנכרון.
  const statusChangeDates = {};
  const qaEntries = Object.entries(statuses).filter(([, name]) => QA_STATUS_RAW_NAMES.includes(String(name).trim().toLowerCase()));
  await Promise.all(qaEntries.map(async ([key, name]) => {
    const d = await fetchStatusEnteredDate(jiraBase, headers, key, name);
    if (d) statusChangeDates[key] = d;
  }));

  return { statuses, estimates, statusChangeDates, notFound };
}

// ─── OAuth routes ─────────────────────────────────────────────────────────────
// אין express-session בפרויקט — שומרים state ב-Map בזיכרון עם TTL של 10 דק'.
// זה מספיק: תהליך יחיד, וה-state נצרך תוך שניות.

const pendingStates = new Map();
const STATE_TTL = 10 * 60 * 1000;

function putState(state) {
  pendingStates.set(state, Date.now() + STATE_TTL);
  for (const [k, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(k);
}

function takeState(state) {
  const exp = pendingStates.get(state);
  if (!exp) return false;
  pendingStates.delete(state);
  return exp >= Date.now();
}

function buildRouter({ authenticate, requireSuperAdmin }) {
  const router = express.Router();

  // GET /api/jira/status — מצב החיבור. editor+ צריך לדעת אם הכפתור זמין.
  router.get('/status', authenticate, (_req, res) => {
    const tokens = loadTokens();
    res.json({
      ok: true,
      configured: isConfigured(),
      connected: !!tokens,
      site: tokens?.cloudName || null,
      siteUrl: tokens?.siteUrl || null,
      // api.atlassian.com/me מחזיר name (לא displayName כמו ב-Jira REST)
      user: tokens?.user?.name || tokens?.user?.nickname || tokens?.user?.email || null,
      // ההרשאות שאושרו בפועל בזמן ההתחברות (מגיעות מ-Atlassian), לצד אלו שהקוד מבקש
      scopes: tokens?.scopes ? String(tokens.scopes).split(/\s+/).filter(Boolean) : null,
      requestedScopes: SCOPES.split(/\s+/),
      connectedAt: tokens?.connected_at || null,
    });
  });

  // GET /api/jira/login — מתחיל OAuth. superadmin בלבד.
  // הטוקן שנוצר משמש את כל המשתמשים, לכן רק superadmin רשאי לקבוע אותו.
  router.get('/login', authenticate, requireSuperAdmin, (_req, res) => {
    if (!isConfigured()) return res.status(400).json({ error: 'jira_not_configured', message: 'חסרים JIRA_CLIENT_ID / JIRA_CLIENT_SECRET / JIRA_REDIRECT_URI ב-.env' });

    const state = crypto.randomBytes(16).toString('hex');
    putState(state);

    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: process.env.JIRA_CLIENT_ID,
      scope: SCOPES,
      redirect_uri: process.env.JIRA_REDIRECT_URI,
      state,
      response_type: 'code',
      prompt: 'consent',
    });
    res.json({ ok: true, url: `${ATLASSIAN_AUTH_URL}?${params.toString()}` });
  });

  // GET /api/jira/callback — Atlassian מפנה לכאן. ללא authenticate (דפדפן, בלי JWT header).
  // ההגנה: פרמטר state חד-פעמי שנוצר רק דרך /login המוגן.
  router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    const done = (msg, ok) => res.type('html').send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;direction:rtl;text-align:center;padding:60px">
       <h2 style="color:${ok ? '#10b981' : '#ef4444'}">${msg}</h2>
       <p style="color:#64748b">אפשר לסגור את החלון הזה.</p>
       <script>setTimeout(()=>window.close(),2500)</script></body>`
    );

    if (error) return done(`שגיאת Jira: ${String(error)}`, false);
    if (!state || !takeState(String(state))) return done('פג תוקף הבקשה או state שגוי — נסה להתחבר שוב.', false);
    if (!code) return done('לא התקבל קוד מ-Jira.', false);

    try {
      const tokenRes = await axios.post(ATLASSIAN_TOKEN_URL, {
        grant_type: 'authorization_code',
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
        code,
        redirect_uri: process.env.JIRA_REDIRECT_URI,
      });
      const t = tokenRes.data;

      const [meRes, resourcesRes] = await Promise.all([
        axios.get(ATLASSIAN_ME_URL,        { headers: { Authorization: `Bearer ${t.access_token}` } }),
        axios.get(ATLASSIAN_RESOURCES_URL, { headers: { Authorization: `Bearer ${t.access_token}` } }),
      ]);

      const resources = resourcesRes.data;
      if (!resources || !resources.length) return done('לא נמצא אתר Jira מקושר לחשבון.', false);

      const cloudId = resources[0].id;
      saveTokens({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: Date.now() + t.expires_in * 1000,
        user: meRes.data,
        cloudId,
        cloudName: resources[0].name,
        jiraBaseUrl: `https://api.atlassian.com/ex/jira/${cloudId}`,
        siteUrl: resources[0].url,
        scopes: t.scope || SCOPES,        // ההרשאות שאושרו בפועל
        connected_at: new Date().toISOString(),
      });

      const who = meRes.data?.name || meRes.data?.nickname || meRes.data?.email || 'unknown';
      console.log(`[jira] Connected: ${who} @ ${resources[0].name}`);
      done('✅ Jira חובר בהצלחה', true);
    } catch (err) {
      console.error('[jira] Callback error:', err.response?.data || err.message);
      done('החיבור נכשל. בדוק את הלוג בשרת.', false);
    }
  });

  // POST /api/jira/logout — מנתק. superadmin בלבד.
  router.post('/logout', authenticate, requireSuperAdmin, (_req, res) => {
    clearTokens();
    res.json({ ok: true });
  });

  return router;
}

module.exports = { buildRouter, fetchIssueStatuses, loadTokens, isConfigured, getValidAccessToken };
