# FinitiOnline — תכנית MAKEOVER: מרשימת השוואת מחירים לרשימת קניות משותפת

> גרסה 1.0 · 2026-10-06 · מסמך תכנון לאישור לפני ביצוע

## 1. תמצית

המוצר משנה כיוון. במקום חנות השוואת מחירים מעל קבצי שקיפות המחירים, FinitiOnline הופכת
ל**רשימת קניות משותפת של המשרד**: מקלידים שם מוצר, קובעים כמות, והרשימה נשלחת במייל
למי שעושה את הקנייה. אין מחירים, אין קטלוג, אין שליפת נתונים מרשתות.

| היום | אחרי ה-MAKEOVER |
|---|---|
| הורדת XML מ-6 רשתות, SQLite של מאות אלפי מחירים, FTS5, תמונות מ-Open Food Facts | טבלה אחת של פריטי רשימה + השלמה אוטומטית ממה שהוקלד בעבר |
| פרוס ב-Render עם Turso בענן, Resend או Gmail למייל | פרוס ב-phptest1 (אותו שרת של QA Board ו-Planner), SQLite מקומי, PM2 + nginx |
| Resend / Gmail SMTP עם סיסמת אפליקציה | SMTP פנימי `dc1.dolcemaster.co.il:25` ללא אימות, כמו בכל שאר המערכות |

מה **נשאר**: מודל ההזדהות (מנהל יחיד ב-OTP למייל + עובדים בשם רשימה וקוד 6 ספרות),
הרשימה המשותפת שמסתנכרנת בין כל המחוברים, היסטוריית רשימות שנסגרו, השליחה השבועית
האוטומטית ביום שלישי 08:00, הגדרות מיתוג (שם + לוגו) ומצב כהה.

## 2. החלטות ארכיטקטורה

### 2.1 שפת ה-backend

| | א. שכתוב ל-Node/Express (מומלץ) | ב. השארת Python/FastAPI מקוצץ |
|---|---|---|
| התאמה לשרת | זהה ל-Planner, jira-qa-track, ratchet: PM2, ecosystem.config.js, better-sqlite3 | צריך venv + pip install בשרת, PM2 עם interpreter python3 — אין תקדים |
| סיכון גרסאות | אין | הקוד דורש Python 3.10+ (pydantic עם `str \| None`). גרסת python3 בשרת לא ידועה |
| היקף | backend חדש ~500 שורות. ה-frontend משוכתב בכל מקרה | מחיקת ~70% מהקוד, התאמת auth ומייל. חוסך ~יום |
| תחזוקה | stack אחיד לכל המערכות | מערכת יחידה ב-Python |
| מה מועתק | `auth.js`, `send_mail.py`, `logger.js`, `db.js` מ-Planner כמעט אחד לאחד | `auth.py`, `email_service.py` קיימים |

**המלצה: א'.** שאר המסמך מניח א'. סעיף 12 מפרט מה משתנה אם תבחר ב'.

### 2.2 מיקום בשרת ו-URL

| פריט | ערך |
|---|---|
| תיקייה | `/var/www/qa.dolcemaster.co.il/finitionline/` |
| פורט | 3030 (3007, 3010, 3011, 3020, 3060 תפוסים) |
| nginx | `location /finitionline/ { proxy_pass http://127.0.0.1:3030/; }` |
| BASE_PATH | `/finitionline` (דפוס jira-qa-track) |
| PM2 | רשומה `finitionline` ב-ecosystem.config.js עם `env: { PORT: 3030, BASE_PATH: '/finitionline' }` |

חלופה: vhost נפרד `finitionline.dolcemaster.co.il` כמו Planner (DNS + תעודה). מעבר מאוחר יותר לא דורש שינוי קוד.

### 2.3 הזדהות — נשאר כמו היום
- מנהל יחיד: `ADMIN_EMAIL` ב-.env, OTP 6 ספרות ב-SMTP פנימי, תוקף 10 דקות, נעילה אחרי 5 ניסיונות (העתקה מ-Planner).
- עובדים: שם רשימה + קוד 6 ספרות → סשן member.
- סשנים ב-DB (תוקף 30 יום), לא JWT, כדי שהמנהל יוכל לנתק את כולם בהחלפת קוד.

### 2.4 Frontend
קובץ HTML יחיד ללא bundler, נכתב מחדש. מועתק: פלטה ותמה (dark mode), דיאלוג התחברות,
עמוד היסטוריה, עמוד הגדרות, טוסט, טיימר השליחה השבועית. נמחק: קטלוג, סינון ערים/רשתות, השוואה, תמונות.

### 2.5 מייל
`send_mail.py` מ-Planner כ-subprocess מ-Node, עם `data/smtp-config.json`:
```json
{"host":"dc1.dolcemaster.co.il","port":25,"secure":false,"fromEmail":"gal@finitione.com","fromName":"FinitiOnline"}
```

## 3. מה נמחק

| קובץ / רכיב | סיבה |
|---|---|
| `pricelist/sources.py`, `parse.py`, `ingest.py`, `refresh.py`, `query.py`, `categories.py`, `images.py`, `city_codes.json` | כל שכבת המחירים |
| `pricelist/db.py` (כולל Turso wrapper) | מוחלף ב-db.js |
| `pricelist/api.py`, `auth.py`, `email_service.py`, `scheduler.py` | משוכתבים ב-Node |
| `shopinglist.py` | אין CLI |
| `static/how.html` | מסביר מנגנון שלא קיים |
| `Dockerfile`, `Procfile`, `render.yaml`, `railway.json`, `requirements.txt`, `run.bat`, `run.ps1`, `.venv/` | Render מתבטל |
| `docs/DEPLOYMENT.md`, `docs/RENDER_DEPLOYMENT.md` | מוחלפים בסעיף פריסה ב-CLAUDE.md |
| טבלאות chains, stores, products, prices, ingest_log, product_images, products_fts | |
| endpoints search/browse/product/basket/categories/image/chains/stores/cities/load_city/load_stores/refresh/stats | |
| env: TURSO_*, RESEND_*, SMTP_USER/PASSWORD/SERVER/PORT, PRICES_* | |

האפיונים הישנים עוברים ל-`docs/archive/`.

## 4. מבנה חדש

```
finitionline/
├── server.js       Express, port 3030, BASE_PATH, סטטיק, routes
├── auth.js         OTP + join-code + sessions + middleware
├── db.js           better-sqlite3, schema + migrations
├── mailer.js       HTML מיילים + קריאה ל-send_mail.py
├── scheduler.js    שליחה שבועית (שעון ישראל)
├── logger.js       לוג יומי
├── send_mail.py    SMTP גולמי (מ-Planner)
├── package.json    express, better-sqlite3, dotenv
├── .env.example
├── public/index.html, public/uploads/
├── data/finitionline.db, data/smtp-config.json   (לא ב-git)
├── logs/
├── docs/makeover-plan.md, docs/archive/
├── CLAUDE.md
└── README.md
```

## 5. מודל נתונים

```sql
settings        (id=1, site_name, logo_url, list_name, join_code, recipients, setup_completed, last_weekly_send, updated_at)
users           (id, email UNIQUE, role 'admin', created_at, last_login)
otp_codes       (id, email, code, expires_at, used, created_at)
locked_accounts (id, email, attempts, locked_until)
sessions        (token PK, role 'admin'|'member', email, display_name, created_at, expires_at)
list_items      (id, name, qty REAL DEFAULT 1, note, checked INTEGER DEFAULT 0, added_by, created_at, updated_at, sort_order)
list_meta       (id=1, version INTEGER)
item_catalog    (name_norm PK, display_name, use_count, last_used_at)
orders          (id, created_at, items_count, payload JSON, source 'manual'|'weekly'|'history', sent_to, sent_at, sent_ok)
```

- shared_baskets נבלעת ב-settings; ה-payload JSON מוחלף בשורות ב-list_items (UPDATE לפי id, בלי נעילה ומיזוג ידני).
- list_meta.version מחליף השוואת JSON מלא כל 10 שניות.
- item_catalog חדש להשלמה אוטומטית.

## 6. API

הזדהות: `POST /api/auth/otp/request`, `POST /api/auth/otp/verify {code}`, `POST /api/auth/join {list_name, join_code, display_name?}`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/revoke-members` (admin).

הגדרות: `GET /api/settings`, `PUT /api/settings` (admin), `POST /api/settings/logo` (admin, multipart 2MB), `POST /api/email/test` (admin).

רשימה: `GET /api/list` → {version, items}, `GET /api/list/version`, `POST /api/list/items {name, qty?, note?}` (שם קיים מעלה כמות), `PATCH /api/list/items/:id`, `DELETE /api/list/items/:id`, `POST /api/list/reorder {ids}`, `DELETE /api/list` (admin), `GET /api/suggest?q=`, `POST /api/list/close {keep_list?}` (שומר + שולח + מרוקן), `POST /api/list/send-now` (admin).

היסטוריה: `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/restore`, `POST /api/orders/:id/send`, `DELETE /api/orders/:id`.

כללי: `GET /api/version`, `GET /api/health`.

## 7. מסכים

7.1 התחברות: דיאלוג חובה, טאב מנהל (OTP) וטאב עובד (שם רשימה + קוד + שם תצוגה).

7.2 הרשימה:
```
[לוגו] שם הרשימה                 🧾 היסטוריה  ⚙ הגדרות
➕ [ הקלד מוצר...            ] [כמות 1]      ← Enter מוסיף; השלמה אוטומטית
☐ חלב 3%        ×2  📝  🗑  (דנה)
☐ לחם פרוס      ×1      🗑  (גל)
── נקנו (1) ──
☑ סוכר          ×1
📅 נשלח אוטומטית ביום שלישי 08:00 · הבא: 13/10
[ סגור רשימה ושלח 📧 ]   [שלח עכשיו] [נקה]   ← admin
```
- פולינג `/api/list/version` כל 5 שניות; התעלמות 3 שניות אחרי עריכה מקומית.
- אין localStorage לרשימה. השרת מקור האמת. localStorage רק ל-token ול-theme.

7.3 היסטוריה: כמו היום בלי ברקוד/מחיר. שלח שוב / טען לרשימה / מחק.

7.4 הגדרות (admin): שם אתר, לוגו, שם רשימה, קוד הצטרפות (+ נתק עובדים), נמענים, מייל בדיקה, תמה, מחיקת חשבון, התנתקות.

## 8. מייל
טבלה: מוצר | כמות | הערה | נוסף על ידי. נושא: `רשימת קניות - {שם} - {תאריך}`. כותרת #17418f.
מגבלות לקוחות מייל כמו ב-Planner. תבנית OTP מועתקת מ-Planner.

## 9. תזמון
setInterval 30 שניות, שעון ישראל. יום שלישי 08:00 → שמירה ל-orders (source=weekly) + שליחה. הרשימה לא מתרוקנת.
`last_weekly_send` ב-settings (לא בזיכרון) מונע שליחה כפולה אחרי restart. הרענון היומי 06:00 נמחק.

## 10. פריסה

```bash
sudo mkdir -p /var/www/qa.dolcemaster.co.il/finitionline/{data,logs,public/uploads}
sudo chown -R gal:www-data /var/www/qa.dolcemaster.co.il/finitionline
# SFTP (curl -T) ואז:
cd /var/www/qa.dolcemaster.co.il/finitionline && npm install
# data/smtp-config.json + .env (PORT=3030 BASE_PATH=/finitionline ADMIN_EMAIL=gal@finitione.com) ידנית
```
nginx:
```nginx
location /finitionline/ { proxy_pass http://127.0.0.1:3030/; proxy_set_header Host $host; client_max_body_size 5m; }
```
PM2 (ecosystem.config.js):
```js
{ name: 'finitionline', cwd: '/var/www/qa.dolcemaster.co.il/finitionline', script: 'server.js', env: { PORT: 3030, BASE_PATH: '/finitionline' } }
```
```bash
sudo /usr/lib/node_modules/pm2/bin/pm2 start ecosystem.config.js --only finitionline
sudo /usr/lib/node_modules/pm2/bin/pm2 save --force
```
גיבוי cron יומי כמו Planner. אריח ב-QA Board (sidebar-nav.json) אופציונלי.
מלכודות: הרשאות קבצים חדשים ב-SFTP, .env ו-smtp-config לא עולים, pm2 רק עם sudo, בדיקה מקומית ב-http://localhost:3030.

## 11. מיגרציה (אופציונלי)
לפני כיבוי Render: למשוך `GET /api/orders` + `GET /api/orders/:id` + `GET /api/settings` (פתוחים ללא אימות) ל-JSON, לטעון עם `scripts/import-legacy.js` חד-פעמי (orders ללא מחירים + זרעים ל-item_catalog).

## 12. אם נבחר Python
נשאר api.py מקוצץ, auth.py, db.py ללא Turso, email_service.py SMTP ללא login, scheduler.py ללא רענון.
PM2: interpreter .venv/bin/python, uvicorn עם `--root-path /finitionline`. דרישה: python3 ≥ 3.10 בשרת.

## 13. שלבים

| שלב | תוכן | בדיקה |
|---|---|---|
| 0 | אישור + החלטות סעיף 14 | — |
| 1 | ניקוי קבצים, archive, .gitignore | commit נקי |
| 2 | db.js, auth.js, server.js, logger.js | curl על כל endpoint |
| 3 | mailer.js, send_mail.py, scheduler.js | מייל בדיקה מ-dc1 |
| 4 | public/index.html | 2 דפדפנים במקביל |
| 5 | פריסה (SFTP, npm install, .env, nginx, PM2) | `curl -sk .../finitionline/api/health` |
| 6 | מיגרציה + כיבוי Render | היסטוריה בייצור |
| 7 | CLAUDE.md, README, זיכרון, אריח QA Board | — |

## 14. החלטות נדרשות
1. Stack: Node/Express (מומלץ) או Python מקוצץ?
2. כתובת: תת-נתיב `/finitionline/` (מומלץ) או vhost נפרד?
3. מיגרציה: לשמר היסטוריה מ-Render או להתחיל ריק?
4. סימון "נקנה" ☐/☑ על פריט: לכלול או לוותר?
