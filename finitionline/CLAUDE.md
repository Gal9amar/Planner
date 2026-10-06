# FinitiOnline — Project Guide for Claude Code

## Overview

FinitiOnline היא **רשימת קניות משותפת של המשרד**: מקלידים שם מוצר וכמות, מסמנים מה נקנה,
והרשימה נשלחת במייל. אין מחירים, אין קטלוג, אין API חיצוני.

הגלגול הקודם (עד 2026-10) היה מנוע השוואת מחירי סופרמרקטים מעל קבצי שקיפות המחירים
(Python/FastAPI, Turso, Render). הוא הוסר לחלוטין; האפיונים ההיסטוריים ב-`docs/archive/`.
תכנית המעבר: `docs/makeover-plan.md`.

**שם הפרויקט הוא FinitiOnline בכל מקום** (לא konimbezol, לא shopinglist).

| פריט | ערך |
|---|---|
| מיקום | `WorkGant/finitionline/` (תת-תיקייה בתוך Planner, repo משותף) |
| Production | `https://planner.dolcemaster.co.il/finitionline/` |
| פורט | **3040** (ייעודי, לא בשימוש באף מערכת אחרת ב-phptest1) |
| Local | `http://127.0.0.1:3040/finitionline/` |
| תהליך | נפרד מ-Planner (PM2 app משלו: `finitionline`) |

אין קישורי ניווט בין Planner ל-FinitiOnline. הן רק חולקות דומיין, תיקייה, `node_modules` ו-`data/smtp-config.json`.

---

## Stack

- Node.js + Express 5, better-sqlite3 (WAL). התלויות נפתרות מ-`../node_modules` של Planner — **אין `npm install` נפרד**.
- Frontend: `public/index.html` יחיד, Vanilla JS, RTL, dark mode (`data-theme` + `prefers-color-scheme`). ללא bundler.
- Email: `send_mail.py` (smtplib, ללא ספריות) דרך SMTP פנימי `dc1.dolcemaster.co.il:25`. שם השולח תמיד **FinitiOnline**.
- Auth: **אין התחברות לעובדים** — העמוד פתוח לכל מי שברשת הפנימית (אין גישה חיצונית). רק פעולות ניהול דורשות מנהל: OTP למייל הקבוע ב-.env, סשן ב-DB (לא JWT). שם העובד הוא תיוג בלבד (`X-User-Name`, נשמר ב-localStorage).
- UI במבנה חנות: קטלוג כרטיסים (כל מוצר שהוזמן אי פעם, מ-`item_catalog`) + עגלה דביקה = הרשימה המשותפת.

## Directory Structure

```
finitionline/
├── server.js        Express: router תחת BASE_PATH, הגדרות, רשימה, היסטוריה, סטטיק, scheduler start
├── auth.js          OTP (מנהל) + join (עובדים) + sessions + authenticate/requireAdmin
├── db.js            סכימה + מיגרציות + עזרים (normName, bumpVersion, touchCatalog)
├── mailer.js        sendMail (spawn של send_mail.py) + תבניות HTML (OTP, רשימה, בדיקה)
├── scheduler.js     שליחה שבועית: יום שלישי 08:00 Asia/Jerusalem, לולאת 30 שניות
├── logger.js        לוג יומי JSON ב-logs/ (30 יום)
├── send_mail.py     SMTP גולמי; קלט JSON ב-stdin (from_name, to_emails[], subject, body_html)
├── env.example      תבנית ל-.env (הקובץ עצמו לא ב-git ולא ב-SFTP)
├── package.json     version → /api/version
├── public/index.html
├── data/finitionline.db     (לא ב-git)
├── data/smtp-config.json    אופציונלי; אם חסר נקרא ../data/smtp-config.json של Planner
└── logs/
```

## .env

```
PORT=3040
HOST=127.0.0.1
BASE_PATH=/finitionline
APP_URL=https://planner.dolcemaster.co.il/finitionline/
FINITIONLINE_ADMIN_EMAIL=gal@finitione.com
SESSION_DAYS=30
OTP_DEBUG=0          # 1 = מדפיס את קוד ה-OTP לקונסול ולא נכשל כשאין SMTP (פיתוח בלבד)
```

`BASE_PATH` חייב להתאים ל-nginx. ה-frontend משתמש ב-URL-ים יחסיים (`api/...`) ולכן עובד תחת כל prefix.

---

## Database (`data/finitionline.db`)

```sql
settings        (id=1, site_name, logo_url (data URL), list_name, join_code, recipients, setup_completed, last_weekly_send, updated_at)
users           (id, email UNIQUE, role 'admin', created_at, last_login)
otp_codes       (id, email, code, expires_at, used, created_at)
locked_accounts (email PK, attempts, locked_until)       -- 5 ניסיונות → נעילה 10 דקות; המפתח 'members' לכניסת עובדים
sessions        (token PK, role admin|member, email, display_name, created_at, expires_at)
list_items      (id, name, name_norm, qty, note, checked, added_by, created_at, updated_at, sort_order)
list_meta       (id=1, version)                           -- עולה בכל שינוי; הלקוח פולל אותה
item_catalog    (name_norm PK, display_name, use_count, last_used_at)   -- השלמה אוטומטית
orders          (id, created_at, items_count, payload JSON, source manual|weekly|history, created_by, sent_to, sent_at, sent_ok)
```

מיגרציות: `addColumnIfMissing` ב-`db.js` (אידמפוטנטי, רץ בכל עלייה).

## API (כולם תחת BASE_PATH; תשובה `{ ok, ... }` או `{ ok:false, error }`)

| Method | Endpoint | הרשאה | תיאור |
|---|---|---|---|
| POST | `/api/auth/otp/request` | — | שולח קוד למייל המנהל (הכתובת רק מ-.env) |
| POST | `/api/auth/otp/verify` | — | `{code}` → token admin |
| GET | `/api/auth/me` | — | `{is_admin}` לפי ה-Bearer |
| POST | `/api/auth/logout` | — | מוחק סשן מנהל |
| GET | `/api/settings` | — | ציבורי + `is_admin`; למנהל גם recipients, admin_email, smtp_config_found |
| PUT | `/api/settings` | admin | `{site_name, list_name?, recipients}` |
| POST/DELETE | `/api/settings/logo` | admin | `{data_url}` עד 2MB / הסרה |
| POST | `/api/email/test` | admin | מייל בדיקה למנהל (או `{to}`) |
| GET | `/api/list`, `/api/list/version` | פתוח | |
| POST | `/api/list/items` | פתוח | `{name, qty?, note?}`; שם קיים (לא מסומן) → מיזוג כמות, `item.merged=true`. `added_by` מ-`X-User-Name` |
| PATCH | `/api/list/items/:id` | פתוח | `{name?, qty?, note?, checked?}`; qty=0 מוחק |
| DELETE | `/api/list/items/:id` | פתוח | |
| DELETE | `/api/list/checked` | פתוח | מסיר את כל הנקנו |
| DELETE | `/api/list` | admin | ריקון מלא (לא נשמר בהיסטוריה) |
| POST | `/api/list/reorder` | פתוח | `{ids[]}` (אין לו UI כרגע) |
| GET | `/api/catalog` | פתוח | כל item_catalog לפי use_count — כרטיסי המוצרים |
| DELETE | `/api/catalog/:name` | admin | הסרה מהקטלוג (לא מהרשימה) |
| PUT/DELETE | `/api/catalog/:name/image` | admin | `{data_url}` תמונת מוצר (הדפדפן מקטין ל-320px JPEG, עד 400KB) / הסרה. נשמר ב-`item_catalog.image` |
| GET | `/api/suggest?q=` | פתוח | עד 10 מ-item_catalog (לא בשימוש ב-UI כרגע; הסינון בקטלוג הוא בצד הלקוח) |
| POST | `/api/list/close` | admin | שומר ל-orders + שולח + מרוקן (`{keep_list:true}` לא מרוקן). מרוקן רק אם המייל נשלח |
| POST | `/api/list/send-now` | admin | שומר + שולח בלי לרוקן |
| GET | `/api/orders`, `/api/orders/:id` | פתוח | |
| POST | `/api/orders/:id/restore` | פתוח | מיזוג הפריטים לרשימה הפעילה |
| POST | `/api/orders/:id/send` | פתוח | שליחה חוזרת (נרשמת כ-order חדש, source=history) |
| DELETE | `/api/orders/:id` | admin | |
| GET | `/api/version`, `/api/health` | — | |

`saveAndSend()` ב-server.js היא הפונקציה היחידה ששומרת ושולחת — משמשת סגירה, שליחה מיידית, שליחה חוזרת והשליחה השבועית.

## Frontend (`public/index.html`)

- נפתח ישר למסך הראשי, בלי התחברות. מבנה חנות: רוחב 80%, קטלוג כרטיסים מימין (`#grid`, מ-`api/catalog`, סינון וחיפוש בצד הלקוח, צ'יפים: הכל/הכי מוזמנים/לאחרונה/ברשימה) ועגלה דביקה משמאל (`#cart` = הרשימה המשותפת). במובייל (<1000px) העגלה היא מגירה (`#cartBtn`).
- שורת החיפוש למעלה: מסננת את הקטלוג; Enter מוסיף לרשימה (התאמה מדויקת בקטלוג או מוצר חדש); כרטיס מקווקו "הוסף כמוצר חדש" כשאין התאמה.
- תמונות מוצר: `iconFor(name)` — אימוג'י לפי ~400 מילות מפתח ומותגים בעברית (`ICONS`, הסדר קובע: ספציפי לפני כללי, ההתאמה הראשונה מנצחת). מנהל יכול להעלות תמונה אמיתית לכל מוצר (📷 על הכרטיס) — `imageFor(name)` מחזיר אותה מהקטלוג והיא מוצגת בכרטיס ובעגלה. אין שליפת תמונות מהאינטרנט (הוחלט 2026-10-06: אין מקור חינמי אמין לעברית).
- localStorage: `fo_admin_token` (מנהל בלבד), `fo_name` (שם העובד, נשלח כ-`X-User-Name`), `theme`. **הרשימה עצמה לא נשמרת מקומית** — השרת מקור האמת.
- פולינג `api/list/version` כל 5 שניות (לא כשהטאב מוסתר); 3 שניות השהיה אחרי עריכה מקומית (`S.lastLocalEdit`).
- כפתור ⚙ הגדרות מוצג **רק למנהל מחובר**. כניסת מנהל דרך הקישור "כניסת מנהל" בפוטר (OTP). מנהל רואה בנוסף: "שלח עכשיו", "נקה הכל", ✕ על כרטיס קטלוג, מחיקה בהיסטוריה.
- 👤 בכותרת: שם העובד + תמה (דיאלוג, לא עמוד הגדרות).
- עמודי היסטוריה והגדרות הם overlay (`.page.on`). אישורים דרך `confirmDlg()` (בלי `confirm()`).

## Email

- `mailer.getSmtpConfig()`: `finitionline/data/smtp-config.json` → `../data/smtp-config.json` (Planner) → ברירת מחדל dc1.
- מגבלות לקוחות מייל: בלי gradient, בלי Google Fonts, border-radius רק על `td`, הכל inline.
- תבנית הרשימה: מוצר | כמות | הערה | נוסף על ידי. פריטים שסומנו "נקנה" מופיעים אחרונים עם סימון.

---

## Deployment (phptest1)

```bash
# פעם אחת
sudo mkdir -p /var/www/planner.dolcemaster.co.il/finitionline/{data,logs,public}
sudo chown -R gal:www-data /var/www/planner.dolcemaster.co.il/finitionline
# .env בשרת (לא עולה ב-SFTP):
sudo tee /var/www/planner.dolcemaster.co.il/finitionline/.env <<'EOF'
PORT=3040
HOST=127.0.0.1
BASE_PATH=/finitionline
APP_URL=https://planner.dolcemaster.co.il/finitionline/
FINITIONLINE_ADMIN_EMAIL=gal@finitione.com
EOF
```

nginx — ב-vhost של planner.dolcemaster.co.il, לפני ה-location הכללי שמפנה ל-3020:
```nginx
location /finitionline/ {
    proxy_pass http://127.0.0.1:3040;        # בלי slash בסוף - הנתיב המלא עובר לאפליקציה (BASE_PATH)
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 5m;
}
location = /finitionline { return 301 https://planner.dolcemaster.co.il/finitionline/; }   # URL מלא מפורש - 301 יחסי יוצא עם :81 של ה-SSL terminator
```
(הוגדר בשרת ב-2026-10-06; גיבוי של הקונפיג הקודם ב-`/root/planner.dolcemaster.co.il.conf.bak-*`.)
`sudo nginx -t && sudo systemctl reload nginx`

PM2 (תהליך נפרד מ-planner):
```bash
cd /var/www/planner.dolcemaster.co.il/finitionline
sudo /usr/lib/node_modules/pm2/bin/pm2 start server.js --name finitionline
sudo /usr/lib/node_modules/pm2/bin/pm2 save --force
# אחרי כל שינוי backend:
sudo /usr/lib/node_modules/pm2/bin/pm2 restart finitionline
```
שינוי ב-`public/index.html` לא דורש restart.

בדיקה: `curl -sk https://planner.dolcemaster.co.il/finitionline/api/health`

העלאה ידנית (uploadOnSave של VSCode לא תופס קבצים ש-Claude כותב):
```bash
curl -k -u gal:PASSWORD -T finitionline/server.js "sftp://phptest1/var/www/planner.dolcemaster.co.il/finitionline/server.js"
```
קובץ חדש ב-SFTP מקבל לפעמים הרשאות שגויות → `sudo chown gal:www-data <file> && sudo chmod 664 <file>`.

**Planner `server.js` חוסם את `/finitionline` לפני הסטטיק שלו** (הסטטיק של Planner מגיש את כל תיקיית השורש). לא להסיר את השורה הזו.

גיבוי: להוסיף ל-cron של root שורה כמו של Planner עבור `finitionline/data/finitionline.db`.

## Common Tasks

- **endpoint חדש:** להוסיף ל-`r` ב-server.js (לפני הסטטיק), עם `authenticate` / `requireAdmin`. לעדכן את הטבלה כאן.
- **שדה חדש בפריט:** `db.js` (addColumnIfMissing) → `listItems()`/`snapshotItems()` ב-server.js → `rowHtml` ב-index.html → `listHtml` ב-mailer.js.
- **שינוי מועד השליחה השבועית:** `SEND_WEEKDAY`/`SEND_HOUR` ב-scheduler.js **וגם** `nextWeeklySendDate()` ב-index.html (הטיימר בתחתית).
