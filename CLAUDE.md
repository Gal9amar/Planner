# Planner — Project Guide for Claude Code

## Overview

Planner הוא כלי פנימי לניהול תוכניות עבודה (גאנטים) — שנתי, חודשי, ספרינט.
נכתב ב-Node.js/Express + React (Babel Standalone, ללא bundler) + SQLite.

**שם קודם:** WorkGant (שונה ל-Planner ב-2026-05-05 — תצוגה בלבד, URL paths ו-CSS classes נשארו `workgant`)
**Production:** `https://planner.dolcemaster.co.il/`
**Local dev:** `http://localhost:3020/`
**GitHub:** `https://github.com/Gal9amar/Planner.git`

---

## Directory Structure

```
WorkGant/
├── server.js               Express server, port 3020
├── auth.js                 Auth endpoints + OTP + JWT + email templates
├── db.js                   better-sqlite3, schema + migrations
├── logger.js               File-based request logger → logs/YYYY-MM-DD.log
├── send_mail.py            SMTP via Python (raw socket, no lib)
├── index.html              Shell ראשי + sidebar + iframe + welcome screen
├── annual.html             תוכנית עבודה שנתית — React SPA
├── monthly.html            תוכנית עבודה חודשית — React SPA
├── sprint.html             תוכנית עבודה ספרינט — React SPA
├── workgant-sidebar.js     Sidebar משותף + login modal + profile screen + admin UI
├── data/
│   ├── workgant.db         SQLite (לא ב-git)
│   └── smtp-config.json    הגדרות SMTP (לא ב-git — מכיל credentials)
├── logs/                   לוג יומי (לא ב-git)
├── test_suite.js           Test suite — מפעיל שרת עצמאי + מייצא HTML report
└── test-reports/           דוחות HTML מהבדיקות (לא ב-git)
```

---

## Stack

- **Backend:** Node.js + Express, better-sqlite3
- **Frontend:** Vanilla JS + React 18 via Babel Standalone (ללא build step)
- **Auth:** JWT (access token) + OTP via email — **אין סיסמאות**
- **Email:** Python script (`send_mail.py`) — raw SMTP socket
- **Port:** 3020 (local), Nginx reverse proxy בייצור
- **Process Manager:** PM2 בייצור — `sudo pm2 restart planner`

---

## Database Schema (workgant.db)

```sql
users                       (id, email, role, is_active, created_at, created_by)
categories                  (id, name, type, sort_order, deleted_at)
gantts                      (id, category_id, name, type, year, state JSON, sort_order, deleted_at)
tasks                       (id, gantt_id, ...)
employees                   (id, name, role, team_id, ...)
teams                       (id, name, ...)
team_members                (team_id, employee_id)
sprints                     (id, name, start_date, end_date)
sprint_items                (id, sprint_id, ...)
user_gantt_permissions      (user_id, gantt_id)
user_category_permissions   (user_id, category_id)
user_all_access             (user_id PK) — גישה לכל הגאנטים כולל עתידיים
otp_codes                   (id, email, code, expires_at, used)
locked_accounts             (id, email, attempts, locked_until, locked_at, unlocked_by, unlocked_at)
```

---

## Auth System

**סוג:** OTP בלבד — **אין סיסמה בכלל** (לא בלוגין ולא ביצירת משתמש).

| Endpoint | תיאור |
|---|---|
| `POST /api/auth/otp/request` | שולח קוד 6 ספרות למייל, תוקף 5 דקות |
| `POST /api/auth/otp/verify` | מאמת קוד → JWT |
| `POST /api/auth/logout` | logout |
| `GET /api/auth/users` | רשימת משתמשים (admin+) |
| `POST /api/auth/users` | יצירת משתמש (admin+) |
| `PATCH /api/auth/users/:id` | עדכון משתמש |
| `DELETE /api/auth/users/:id` | מחיקת משתמש |
| `POST /api/auth/email/test` | שליחת מייל בדיקה (superadmin) |
| `POST /api/auth/email/preview` | שליחת תבנית מייל לבדיקה — `{ type: 'welcome'/'otp'/'both', to: '...' }` (superadmin) |
| `GET /api/auth/logs` | לוג פעולות (superadmin) |
| `GET/DELETE /api/auth/locked-accounts` | חשבונות נעולים (superadmin) |

**Roles:** `superadmin` → `admin` → `editor` → `viewer`

**הרשאות גאנטים:**
- `superadmin` — גישה לכל, יוצר admins, מנהל all_access
- `admin` — צריך הרשאה מפורשת לכל גאנט; רואה רק משתמשים שהוא יצר (`created_by`); יוצר viewer/editor בלבד בתוך הבורדים שלו; לא יכול להעניק הרשאות מעבר לשלו (`clampToAdminPerms`)
- `editor` — רק גאנטים שהוקצו ספציפית; יוצר גאנט חדש → מקבל הרשאה אוטומטית עליו
- `viewer` — קריאה בלבד לגאנטים שהוקצו

**`user_all_access`:** דגל נפרד — "גישה לכל הגאנטים כולל עתידיים". רק superadmin יכול להעניק/לשלול. כשנוצרת קטגוריה חדשה — כל בעל all_access מקבל הרשאה אוטומטית.

**cascade delete:** מחיקת admin **לא** מוחקת משתמשים שיצר — הם נשארים במערכת.

---

## API Endpoints (server.js)

| Endpoint | Method | Auth | תיאור |
|---|---|---|---|
| `/api/categories` | GET | viewer+ | קטגוריות + גאנטים (מסונן לפי הרשאה) |
| `/api/categories` | POST | admin+ | יצירת קטגוריה |
| `/api/categories/:id` | PATCH | admin+ | עדכון שם קטגוריה |
| `/api/categories/:id` | DELETE | admin+ | מחיקת קטגוריה (soft) |
| `/api/gantts/:id` | GET | viewer+ | טען גאנט |
| `/api/gantts` | POST | editor+ | יצירת גאנט |
| `/api/gantts/:id` | PATCH | admin+ | שינוי שם גאנט |
| `/api/gantts/:id/state` | PATCH | editor+ | שמור state גאנט |
| `/api/gantts/:id` | DELETE | admin+ | מחיקת גאנט (soft) |
| `/api/employees` | GET/POST | editor+ | עובדים |
| `/api/employees/:id` | PUT/DELETE | editor+ | עדכן/מחק עובד |
| `/api/teams` | GET/POST | editor+ | צוותים |
| `/api/teams/:id` | PATCH/DELETE | editor+ | עדכן/מחק צוות |
| `/api/teams/:id/members` | POST | editor+ | הוסף חבר לצוות |
| `/api/teams/:id/members/:mid` | PATCH/DELETE | editor+ | עדכן/מחק חבר |
| `/api/version` | GET | public | גרסה (נקרא מ-package.json בהפעלה) |
| `/api/backups` | GET | superadmin | רשימת קבצי גיבוי (שם, גודל, תאריך) |
| `/api/backups/:filename` | DELETE | superadmin | מחיקת קובץ גיבוי |
| `/api/backups/:filename/restore` | POST | superadmin | שחזור גיבוי → copy over DB + process.exit(0) |

---

## Email Templates (auth.js)

שתי פונקציות: `sendOtpEmail(email, otp)` ו-`sendWelcomeEmail(email, _password, role)`.

**חשוב להגבלות email clients:**
- `linear-gradient` — לא עובד ב-Gmail/Outlook → להשתמש ב-`background-color` אחיד בלבד
- Google Fonts — לא נטענים → להשתמש ב-web-safe fonts בלבד (`'Arial Black'`, `Arial` וכו')
- `border-radius` על `<table>` — לא עובד ב-Outlook → רק על `<td>`

**עיצוב:** header עם `background:#0f172a`, לוגו "PLANNER" ב-Arial Black, accent `#6366f1`.

**Welcome email:** מכיל אימייל + הסבר OTP (ללא סיסמה) + 6 כרטיסי פיצ'רים + 3 סוגי גאנט + קטע "איך להתחבר?" עם 2 כרטיסיות:

- **מהמשרד** — גישה ישירה לכתובת האתר
- **מחוץ למשרד** — הפעלת VPN + FortiGate לפני הכניסה

---

## Sidebar (workgant-sidebar.js)

IIFE המוזרק לכל דף. כולל:
- Login modal דו-שלבי (מייל → קוד OTP עם טיימר)
- Profile screen עם טאבים: **משתמשים**, **בדיקות מיילים**, **נעולים**, **לוגים** (superadmin)
- טאב "בדיקות מיילים" — שליחת מייל SMTP רגיל + שליחת תבניות welcome/OTP לכתובת נבחרת
- ניהול משתמשים: יצירה, עריכה, הרשאות גאנטים/קטגוריות, all_access toggle (superadmin)
- עיצוב dark-premium: `background:#0f172a`, לוגו Syne 800, gradient glow

**גאנט types בסיידבר:**
- ספרינט — badge סגול (`#c4b5fd`)
- שנתי — badge כחול (`#7dd3fc`)
- חודשי — badge ירוק (`#6ee7b7`)

**כפתור מחיקת גאנט:** נמצא בדף ההגדרות של כל גאנט (לא בסיידבר). כפתור מחיקת בורד (קטגוריה) — בסיידבר (כי אין לבורד דף הגדרות).

---

## Running

### Local
```bash
cd "C:/Users/gal.000/Desktop/WorkGant"
node server.js
# → http://localhost:3020/
```

### Production (שרת)
```bash
sudo pm2 restart planner
```

**גרסה:** נקראת מ-`package.json` בהפעלת השרת. שינוי גרסה מחייב restart כדי להתעדכן בסיידבר.

### Tests
```bash
node test_suite.js
# מפעיל שרת עצמאי עם TEST_MODE=1, מריץ ~78 בדיקות, מייצא HTML report
```

---

## Key Patterns

### Frontend
- **React SPA ללא bundler** — Babel Standalone, כל ה-JSX ב-`<script type="text/babel">`
- **Soft delete** — גאנטים וקטגוריות לא נמחקים פיזית (`deleted_at`)
- **Gantt state** — כל תוכן הגאנט נשמר כ-JSON ב-`gantts.state`
- **iframe bridge** — `window.parent._wgsb` לתקשורת בין iframe הגאנט לסיידבר
- **`window.top.location.href`** — ניווט בטוח מתוך iframe

### Backend
- **TEST_MODE** — `process.env.TEST_MODE=1` מדכא כל שליחת מייל (OTP + Welcome)
- **WAL mode** — SQLite רץ ב-WAL לביצועים טובים יותר
- **`/api/version`** — endpoint ציבורי, הגרסה נטענת פעם אחת בהפעלה מ-`package.json`

### Email
- **`send_mail.py`** — SMTP ישיר (לא nodemailer)
- **`data/smtp-config.json`** — לא ב-git, צריך ליצור ידנית בשרת:
  ```json
  {"host":"dc1.dolcemaster.co.il","port":25,"secure":false,"fromEmail":"gal@finitione.com","fromName":"Planner"}
  ```

---

## .gitignore (מה לא עולה)

```
node_modules/
data/workgant.db + WAL
logs/
.env
data/smtp-config.json
test-reports/
```

---

## Test Suite

**קובץ:** `test_suite.js`
**כמות בדיקות:** ~78

**סקשנים:**
1. אימות — OTP
2. הכנת נתוני בדיקה
3. ניהול קטגוריות
4. ניהול גאנטים
5. צופה (Viewer) — הרשאות
6. עורך (Editor) — הרשאות
7. מנהל (Admin) — הרשאות
8. **הרשאות מורחבות — שינויים חדשים** (all_access, created_by, clamp, cascade, email preview)
9. ניהול צוותים
10. מקרי קצה
11. לוגים ותיעוד
12. ניקוי נתוני בדיקה

**איך עובד:**
1. הורג כל שרת קיים על port 3020
2. מפעיל שרת חדש עם `TEST_MODE=1`
3. יוצר fixtures (קטגוריה + 2 גאנטים)
4. מריץ את כל הבדיקות
5. מייצא HTML report ל-`test-reports/`
6. מנקה נתוני בדיקה
7. הורג את השרת
