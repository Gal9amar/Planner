# Planner — Project Guide for Claude Code

## Overview

Planner הוא כלי פנימי לניהול תוכניות עבודה (גאנטים) — שנתי, חודשי, ספרינט.
נכתב ב-Node.js/Express + React (Babel Standalone, ללא bundler) + SQLite.

**שם קודם:** WorkGant (שונה ל-Planner ב-2026-05-05 — תצוגה בלבד, URL paths ו-CSS classes נשארו `workgant`)
**Production:** `https://qa.dolcemaster.co.il/workgant/`
**Local dev:** `http://localhost:3020/workgant/`
**GitHub:** `https://github.com/Gal9amar/Planner.git`

---

## Directory Structure

```
WorkGant/
├── server.js               Express server, port 3020
├── auth.js                 Auth endpoints + OTP + JWT + email
├── db.js                   better-sqlite3, schema + migrations
├── logger.js               File-based request logger → logs/YYYY-MM-DD.log
├── send_mail.py            SMTP via Python (raw socket, no lib)
├── index.html              Shell ראשי + sidebar + iframe
├── annual.html             תוכנית עבודה שנתית — React SPA
├── monthly.html            תוכנית עבודה חודשית — React SPA
├── sprint.html             תוכנית עבודה ספרינט — React SPA
├── workgant-sidebar.js     Sidebar משותף + login modal + profile screen
├── qa-nav.js               ניווט עזר (legacy)
├── data/
│   ├── workgant.db         SQLite (לא ב-git)
│   ├── sidebar-nav.json    תפריט ניווט (לא בשימוש כרגע)
│   └── smtp-config.json    הגדרות SMTP (לא ב-git — מכיל credentials)
├── logs/                   לוג יומי (לא ב-git)
├── test_suite.js           Test suite — מפעיל שרת עצמאי + מייצא HTML
├── test-reports/           דוחות HTML מהבדיקות (לא ב-git)
└── .env                    env vars (לא ב-git)
```

---

## Stack

- **Backend:** Node.js + Express 5, better-sqlite3
- **Frontend:** Vanilla JS + React 18 via Babel Standalone (ללא build step)
- **Auth:** JWT (access token) + Refresh token + OTP via email
- **Email:** Python script (`send_mail.py`) — raw SMTP socket
- **Port:** 3020 (local), Nginx reverse proxy בייצור

---

## Database Schema (workgant.db)

```sql
users               (id, email, password_hash, role, is_active, created_at)
roles               (id, name)
categories          (id, name, type, sort_order, deleted_at)
gantts              (id, category_id, name, type, year, state JSON, sort_order, deleted_at)
tasks               (id, gantt_id, ...)
employees           (id, name, role, team_id, ...)
teams               (id, name, ...)
team_members        (team_id, employee_id)
sprints             (id, name, start_date, end_date)
sprint_items        (id, sprint_id, ...)
user_gantt_permissions      (user_id, gantt_id)
user_category_permissions   (user_id, category_id)
refresh_tokens      (id, user_id, token, expires_at)
login_attempts      (id, email, ip, created_at)
otp_codes           (id, email, code, expires_at, used)
locked_accounts     (id, email, locked_until, reason)
audit_logs          (id, user_id, action, entity_type, entity_id, entity_name, ip, created_at)
```

---

## Auth System

**סוג:** OTP בלבד — אין סיסמה בטופס login.

| Endpoint | תיאור |
|---|---|
| `POST /workgant/api/auth/otp/request` | שולח קוד 6 ספרות למייל, תוקף 5 דקות |
| `POST /workgant/api/auth/otp/verify` | מאמת קוד → JWT + refresh token |
| `POST /workgant/api/auth/refresh` | מרענן JWT |
| `POST /workgant/api/auth/logout` | מבטל refresh token |
| `GET /workgant/api/auth/users` | רשימת משתמשים (admin+) |
| `POST /workgant/api/auth/users` | יצירת משתמש (superadmin) |
| `PATCH /workgant/api/auth/users/:id` | עדכון משתמש |
| `DELETE /workgant/api/auth/users/:id` | מחיקת משתמש |
| `GET /workgant/api/auth/logs` | לוג פעולות (admin+) |
| `GET/DELETE /workgant/api/auth/locked-accounts` | חשבונות נעולים (superadmin) |

**Roles:** `superadmin` → `admin` → `editor` → `viewer`

**הרשאות גאנטים:**
- `superadmin` / `admin` — גישה לכל הגאנטים
- `editor` / `viewer` — רק גאנטים שהוקצו ספציפית (`user_gantt_permissions`) או קטגוריה שלמה (`user_category_permissions`)
- `editor` שיוצר גאנט חדש מקבל הרשאה אוטומטית עליו

---

## API Endpoints (server.js)

| Endpoint | Method | Auth | תיאור |
|---|---|---|---|
| `/workgant/api/categories` | GET | any | קטגוריות + גאנטים (מסונן לפי הרשאה) |
| `/workgant/api/categories` | POST | admin+ | יצירת קטגוריה |
| `/workgant/api/categories/:id` | DELETE | admin+ | מחיקת קטגוריה (soft) |
| `/workgant/api/gantts/:id` | GET | viewer+ | טען גאנט |
| `/workgant/api/gantts` | POST | editor+ | יצירת גאנט |
| `/workgant/api/gantts/:id/state` | PATCH | editor+ | שמור state גאנט |
| `/workgant/api/gantts/:id` | DELETE | admin+ | מחיקת גאנט (soft) |
| `/workgant/api/employees` | GET/POST | editor+ | עובדים |
| `/workgant/api/employees/:id` | PUT/DELETE | editor+ | עדכן/מחק עובד |
| `/workgant/api/teams` | GET/POST | editor+ | צוותים |
| `/workgant/api/teams/:id` | PUT/DELETE | editor+ | עדכן/מחק צוות |
| `/workgant/api/sprints` | GET/POST | editor+ | ספרינטים |

---

## Running

### Local
```bash
cd "C:/Users/gal.000/Desktop/WorkGant"
node server.js
# → http://localhost:3020/workgant/
```

### Production (שרת)
```bash
sudo pkill -f workgant/server.js
sudo nohup node /var/www/qa.dolcemaster.co.il/workgant/server.js >> /tmp/workgant.log 2>&1 &
```

### Tests
```bash
node test_suite.js
# מפעיל שרת עצמאי עם TEST_MODE=1 (אפס מיילים), מריץ 41 בדיקות, מייצא HTML report
```

---

## Key Patterns

### Frontend
- **React SPA ללא bundler** — Babel Standalone, כל ה-JSX ב-`<script type="text/babel">`
- **Soft delete** — גאנטים וקטגוריות לא נמחקים פיזית (`deleted_at`)
- **Gantt state** — כל תוכן הגאנט נשמר כ-JSON ב-`gantts.state`
- **Sidebar** — `workgant-sidebar.js` — IIFE, מוזרק לכל דף

### Backend
- **TEST_MODE** — `process.env.TEST_MODE=1` מדכא כל שליחת מייל (OTP + Welcome)
- **WAL mode** — SQLite רץ ב-WAL לביצועים טובים יותר

### Email
- **`send_mail.py`** — SMTP ישיר (לא nodemailer)
- **`data/smtp-config.json`** — לא ב-git, צריך ליצור ידנית בשרת
- בשרת: `{"host":"dc1.dolcemaster.co.il","port":25,"secure":false,"fromEmail":"gal@finitione.com","fromName":"Planner"}`

---

## .gitignore (מה לא עולה)

```
node_modules/
data/workgant.db + WAL
logs/
.env
data/smtp-config.json
.claude/
test-reports/
Planner/          ← תיקייה ריקה שנוצרה בטעות
```

---

## Test Suite

**קובץ:** `test_suite.js`
**מה בודק:** Auth (OTP), הרשאות (viewer/editor/admin/superadmin), edge cases, logs
**איך עובד:**
1. הורג כל שרת קיים על port 3020
2. מפעיל שרת חדש עם `TEST_MODE=1`
3. יוצר fixtures (קטגוריה + 2 גאנטים) — לא מסתמך על נתונים קיימים
4. מריץ 41 בדיקות
5. מייצא HTML report ל-`test-reports/`
6. מנקה את כל הנתונים שנוצרו
7. הורג את השרת

**חשוב:** `@test.com` כתובות לא מקבלות מיילים כי `TEST_MODE=1` מדכא שליחה.
