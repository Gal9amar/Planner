# Planner — Project Guide for Claude Code

## Overview

Planner הוא כלי פנימי לניהול תוכניות עבודה (גאנטים) — שנתי, חודשי, ספרינט.
נכתב ב-Node.js/Express + React (Babel Standalone, ללא bundler) + SQLite.

**שם קודם:** WorkGant (שונה ל-Planner ב-2026-05-05 — תצוגה בלבד, URL paths ו-CSS classes נשארו `workgant`)
**Production:** `https://planner.dolcemaster.co.il/`
**Local dev:** `http://localhost:3020/`
**GitHub:** `https://github.com/Gal9amar/Planner.git`

---

## ⚠️ קוד כפול בשלושת הגאנטים — קרא לפני כל שינוי

`annual.html`, `monthly.html`, `sprint.html` הם **שלושה קבצים עם קוד כמעט זהה, לא משותף** (~3,200–3,400 שורות כל אחד). כל תיקון או תוספת רלוונטית חייבים להיות מיושמים בכל הקבצים הרלוונטיים — אחרת נוצר drift שקט.

### תקרית 2026-07-23 — אובדן `task_number`

הפונקציות `stateToPayload` ו-`apiStateToAppState` ב-`sprint.html` וב-`monthly.html` **לא כללו את השדה `task_number`** (ב-`annual.html` הוא כן היה). ה-autosave (debounce 800ms על כל שינוי) כתב ערך ריק בכל טעינה/שמירה ומחק בהדרגה את מספרי המשימות. שוחזרו 58 משימות בגאנט ID 75 ידנית ממיפוי Jira.

**המסקנה המעשית:** בכל הוספת שדה למשימה — לבדוק **את שני צידי ה-round-trip בכל שלושת הקבצים**. הבדיקות ב-`test_suite.js` תחת "task_number persistence" נוספו בעקבות זאת; אין להסיר אותן.

### באגים דומים שנמצאו מאותו שורש (2026-07-26)

- **`color2` בייצוא HTML** — הקוד צייר טקסט ב-`s.color`, אבל בסכימה החדשה `color === bg` → טקסט בלתי-נראה. תוקן ב-4 מקומות.
- **צבעים פסטליים בגאנטים ישנים** — `workdays_base` שמור עם סכימה עתיקה; נוצר `normalizeStatusColors` לריפוי בטעינה.

---

## Directory Structure

```
WorkGant/
├── server.js               Express server, port 3020
├── auth.js                 Auth endpoints + OTP + JWT + email templates
├── db.js                   better-sqlite3, schema + migrations
├── logger.js               File-based request logger → logs/YYYY-MM-DD.log
├── jira.js                 Jira OAuth 3LO + token store + fetchIssueStatuses
├── jira-scheduler.js       סנכרון סטטוסים אוטומטי ברקע (א׳–ה׳ 07:00–20:00)
├── send_mail.py            SMTP via Python (raw socket, no lib)
├── index.html              Shell ראשי + sidebar + iframe + welcome screen
├── annual.html             תוכנית עבודה שנתית — React SPA
├── monthly.html            תוכנית עבודה חודשית — React SPA
├── sprint.html             תוכנית עבודה ספרינט — React SPA
├── workgant-sidebar.js     Sidebar משותף + login modal + profile screen + admin UI
├── data/
│   ├── workgant.db         SQLite (לא ב-git)
│   ├── smtp-config.json    הגדרות SMTP (לא ב-git — מכיל credentials)
│   └── jira-tokens.json    טוקני Jira OAuth (לא ב-git — נוצר בהתחברות)
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
gantts                      (id, category_id, name, type, year, month, hours_per_day, workdays_base JSON,
                             sprint_start, sprint_end, freeze_date, jira_auto_sync, jira_synced_at,
                             sort_order, created_at, deleted_at)
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
| `/api/gantts/:id/jira-sync` | POST | editor+ | `{ keys[] }` → סטטוסים מ-Jira (**לא כותב ל-DB**) |
| `/api/gantts/:id/jira-auto-sync` | PATCH | editor+ | `{ enabled }` — מתג סנכרון רקע (חסום ל-annual) |
| `/api/jira/status` | GET | viewer+ | מצב חיבור + scopes + שם אתר/משתמש |
| `/api/jira/login` | GET | superadmin | מחזיר `{ url }` להפניה ל-Atlassian |
| `/api/jira/callback` | GET | — | OAuth callback; מוגן ב-`state` חד-פעמי |
| `/api/jira/logout` | POST | superadmin | מוחק את הטוקנים |

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
- Profile screen עם טאבים: **משתמשים**, **בדיקות מיילים**, **נעולים**, **לוגים**, **בדיקות**, **גיבויים**, **Jira** (superadmin)
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

### Deployment (SFTP)

`.vscode/sftp.json` → `gal@phptest1:/var/www/planner.dolcemaster.co.il`. העלאה ידנית ב-curl:

```bash
curl -k -T <file> "sftp://phptest1/var/www/planner.dolcemaster.co.il/<file>" -u "user:pass"
```

**מלכודות (התנסינו בכולן):**

- **`.env` לא עולה ב-SFTP** — יש לעדכן ידנית בשרת ולהפעיל מחדש. שינוי מקומי בלבד לא משפיע על ייצור.
- **קבצים חדשים מקבלים קבוצה שגויה** (`gal:domain users` במקום `gal:www-data`) — אחרי העלאת קובץ חדש: `sudo chown gal:www-data <file> && sudo chmod 775 <file>`.
- **SSH דורש סיסמה אינטראקטיבית** — לא ניתן להריץ `sudo`/`pm2` אוטומטית; המשתמש מריץ בעצמו.
- **`curl https://` מהשרת אל עצמו נתקע** (DNS פנימי) — לבדיקה מקומית להשתמש ב-`http://localhost:3020`.
- **שינויי frontend** (`*.html`, `workgant-sidebar.js`) לא דורשים restart — רק `Ctrl+Shift+R`. שינויי backend (`server.js`, `db.js`, `jira*.js`) דורשים `pm2 restart`.
- אימות העלאה: להשוות גדלים — `stat -c%s <file>` מול הורדה חזרה ב-curl.

### Tests
```bash
node test_suite.js
# מפעיל שרת עצמאי עם TEST_MODE=1, מריץ 119 בדיקות, מייצא HTML report
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

## Manpower — ימי היעדרות (monthly.html + sprint.html)

### מחזור לחיצות על יום עבודה

```
null → 'vacation' → 'sick' → 'half' → null
```

| ערך | צבע | תצוגה |
| --- | --- | --- |
| `null/false` | ירוק | שעות רגילות |
| `'vacation'` | אדום | חופש |
| `'sick'` | כתום | מחלה |
| `'half'` | סגול | חצי |

### State

```js
manpower: { hours_per_day: 8.5, half_day_hours: 4.5, employees: [] }
```

- `half_day_hours` — שעות "חצי יום" (ברירת מחדל 4.5), ניתן לערוך ב-UI
- Reducer `SET_HALF_DAY_HOURS` — מעדכן `manpower.half_day_hours`
- Reducer `SET_EMP_DAY_OFF` — מחזור כולל `'half'`

### פונקציות

- `monthly.html`: `personMonthlyHours(emp, hpd, year, month, halfDayHours)`
- `sprint.html`: `personSprintHours(emp, hpd, rangeDays, halfDayHours)`
- `roleHoursByDay(...)` — מקבלת `halfDayHours` כפרמטר אחרון בשני הקבצים

כל call sites (Dashboard, TasksScreen, ResourcesScreen, ManpowerScreen, exportToExcel) מעבירים `halfDayHours`.

---

## Task Statuses (monthly.html + sprint.html)

```js
const TASK_STATUSES = [
    { value: 'pending', label: 'ממתין',   color: '#64748b', bg: '#64748b', color2: '#ffffff' },
    { value: 'in-dev',  label: 'בפיתוח',  color: '#3b82f6', bg: '#3b82f6', color2: '#ffffff' },
    { value: 'rfq',     label: 'RFQ',     color: '#f59e0b', bg: '#f59e0b', color2: '#ffffff' },
    { value: 'testing', label: 'בבדיקות', color: '#f97316', bg: '#f97316', color2: '#ffffff' },
    { value: 'done',    label: 'הושלם',   color: '#10b981', bg: '#10b981', color2: '#ffffff' },
];
```

⚠️ **`color2` הוא צבע הטקסט — חובה להשתמש בו.** בסכימה הנוכחית `color === bg` (רקע מלא), ולכן קוד שמצייר טקסט עם `s.color` יוצר טקסט בצבע הרקע = בלתי-נראה. זה היה באג אמיתי בייצוא ה-HTML (תוקן 2026-07-26). הדפוס הנכון:

```js
background: s.bg || s.color;  color: s.color2 || '#fff';
```

**רשימת הסטטוסים נשמרת פר-גאנט** ב-`gantts.workdays_base.taskStatuses` וניתנת לעריכה מלאה בדף ההגדרות. `TASK_STATUSES` הוא ברירת מחדל לגאנטים חדשים בלבד.

**`normalizeStatusColors(list)`** (ב-`apiStateToAppState` של שני הקבצים) — גאנטים ישנים נשמרו עם צבעים פסטליים (`bg:'#ecfdf5'`) שכמעט בלתי-קריאים. הפונקציה מרפאה בטעינה **רק את 5 סטטוסי הליבה** לפי `value`; סטטוסים שהמשתמש הגדיר או שנוצרו מ-Jira נשארים כפי שהם.

### Task Types

```js
const DEFAULT_TASK_TYPES = ['תשתית','שוטף','באגים','פרויקט','אוטומציה','ידני','ריגרסיות'];
```

3 האחרונים נוספו 2026-07-26 ב-sprint+monthly בלבד (annual נשאר עם 4). **חל על גאנטים חדשים בלבד** — בקיימים יש להוסיף ידנית בהגדרות.

### Jira Status Mapping (ייבוא מ-Jira)

```js
const JIRA_STATUS_MAP = {
    'open':           'pending',
    'in dev':         'in-dev',
    'ready for dev':  'pending',
    'ready for qa':   'rfq',
    'testing':        'testing',
    'qa':             'testing',
    'po review':      'done',
    // כל ערך לא מוכר → 'pending'
};
```

עמודות הייבוא: **Issue key** → `task_number`, **Summary** → `name`, **Status** → `status` (ממופה דרך `JIRA_STATUS_MAP`).

---

## Jira Live Sync — סנכרון סטטוסים (monthly.html + sprint.html)

חיבור חי ל-Jira Cloud שמושך את הסטטוס העדכני לפי `task_number` (Issue key). **הסטטוס ב-Jira הוא הקובע** — הוא דורס עריכה ידנית בגאנט.

### Backend — `jira.js`

- **OAuth 3LO** מול Atlassian (אותה זרימה כמו ב-`jira-qa-track`, קוד עצמאי). Scopes: `read:jira-work read:me offline_access`
- טוקנים ב-`data/jira-tokens.json` (**לא ב-git**), רענון אוטומטי 5 דק' לפני פקיעה
- אין `express-session` בפרויקט — פרמטר ה-`state` נשמר ב-`Map` בזיכרון עם TTL של 10 דק'

| Endpoint | Method | Auth | תיאור |
|---|---|---|---|
| `/api/jira/status` | GET | viewer+ | האם מוגדר/מחובר, שם האתר והמשתמש |
| `/api/jira/login` | GET | superadmin | מחזיר `{ url }` להפניה ל-Atlassian |
| `/api/jira/callback` | GET | — | מוגן ב-`state` חד-פעמי (הדפדפן מגיע בלי JWT) |
| `/api/jira/logout` | POST | superadmin | מוחק את הטוקנים |
| `/api/gantts/:id/jira-sync` | POST | editor+ | `{ keys[] }` → `{ statuses, notFound, checked }` |

**`fetchIssueStatuses(keys)`** — `GET {jiraBase}/rest/api/3/search/jql` עם `jql: key IN (...)`, `fields=status`, batching של 100 + pagination דרך `nextPageToken`.

**`jira-sync` לא כותב ל-DB** — מחזיר נתונים בלבד; הלקוח מחיל ושומר דרך `PATCH /state` הרגיל. זו הגנה מכוונת מפני כתיבה אוטומטית לא מפוקחת (ראה תקרית `task_number` למעלה).

### Frontend

- `jiraStatusToValue(raw, statuses)` — סדר עדיפויות: `JIRA_STATUS_MAP` → התאמה לפי `label` קיים → `'jira:' + שם ב-lowercase`
- `jiraStatusColor(raw)` — hash יציב על השם, כך שאותו סטטוס מקבל תמיד אותו צבע בכל הגאנטים
- Reducer **`APPLY_JIRA_STATUSES`** — מחיל סטטוסים, ו**מוסיף אוטומטית** ל-`state.taskStatuses` כל סטטוס Jira שאינו קיים (צבע ניתן לשינוי אחר-כך בדף ההגדרות)
- כפתור "🔄 סנכרן סטטוסים מ-Jira" ב-TasksScreen; ההודעה מדווחת כמה עודכנו וכמה keys לא נמצאו ב-Jira

### סינון וכפתורים ב-TasksScreen

שלושה פילטרים מצטברים: חיפוש טקסט (שם או `task_number`) · סוג · **סטטוס** (עם מונה חי לכל סטטוס, גבול נצבע בצבע הסטטוס הנבחר). בנוסף "✕ נקה סינון" ומחוון "מוצגות N מתוך M" — שניהם מופיעים רק כשיש סינון פעיל.

⚠️ **`idx` נשמר לפני הסינון** (`tasks.map((t,idx) => ({...t, idx})).filter(...)`) — קריטי: בלעדיו עריכה בטבלה מסוננת תכתוב למשימה הלא-נכונה.

שלושת כפתורי הייבוא ומקורותיהם:

| כפתור | מקור |
|---|---|
| ייבא מגאנט שנתי | `/api/annual-gantts/all-with-tasks` |
| ייבא משימות Jira | קובץ Excel (SheetJS, בדפדפן) |
| 🔄 סנכרן סטטוסים מ-Jira | Jira REST API (חי) |

### הגדרה (`.env`)

```
JIRA_CLIENT_ID=...
JIRA_CLIENT_SECRET=...
JIRA_REDIRECT_URI=https://planner.dolcemaster.co.il/api/jira/callback
JIRA_SYNC_ENABLED=1
```

**חשוב:** `.env` מוחרג מ-SFTP ולכן **לא עולה אוטומטית** — יש לעדכן אותו ידנית בשרת (`sudo nano .env` / `tee -a`) ולהפעיל מחדש.

**Scopes:** Planner מבקש 3 — `read:jira-work read:me offline_access`. אפליקציית ה-OAuth מאשרת גם `read:jira-user`, אבל היא נדרשת ל-jira-qa-track בלבד; Planner אינו מבקש אותה (מינימום הרשאות).

**גוצ׳ה:** `https://api.atlassian.com/me` מחזיר את שם המשתמש בשדה **`name`** — לא `displayName` (זה קיים ב-Jira REST API, לא ב-`/me`). שימוש ב-`displayName` נותן `undefined`.

ה-redirect URI חייב להיות רשום באפליקציית ה-OAuth ב-`developer.atlassian.com` (Authorization → OAuth 2.0 3LO → Callback URL). האפליקציה משותפת עם jira-qa-track — יש להוסיף שורה, **לא להחליף**, אחרת jira-qa-track יישבר.

`SESSION_SECRET` **אינו נדרש** ב-Planner (אין `express-session`; ה-`state` נשמר ב-Map בזיכרון).

### UI — טאב "Jira" בפרופיל

`workgant-sidebar.js`, superadmin בלבד: מציג מצב חיבור (לא מוגדר / לא מחובר / מחובר + שם אתר ומשתמש) עם כפתורי התחבר/נתק/רענן. ההתחברות נפתחת ב-popup; לאחר סגירתו יש ללחוץ "רענן". פונקציות: `loadJiraStatus()`, `jiraLogin()`, `jiraLogout()`.

### סנכרון אוטומטי ברקע — `jira-scheduler.js`

**חלון ריצה:** ימים א׳–ה׳, 07:00–20:00, בכל שעה עגולה וחצי (27 סבבים ביום).
**היקף:** רק גאנטים מסוג `sprint`/`monthly` שבהם `jira_auto_sync = 1` — **כבוי כברירת מחדל לכל גאנט**.

**הפעלה:** `JIRA_SYNC_ENABLED=1` ב-`.env` (בלעדיו ה-scheduler לא עולה כלל).

עמודות חדשות ב-`gantts`: `jira_auto_sync INTEGER DEFAULT 0`, `jira_synced_at TEXT`.
Endpoint: `PATCH /api/gantts/:id/jira-auto-sync` (editor+, `{ enabled: bool }`) — חסום ל-`annual`.
UI: כרטיס "סנכרון אוטומטי מ-Jira" בדף ההגדרות של הגאנט (מתג שנשמר מיידית, מחוץ לסרגל השמירה).

**אמצעי בטיחות** (נגזרים מתקרית `task_number`):

- כותב אך ורק ל-`tasks.status` לפי `id` — לא מוחק שורות, לא נוגע בשדות אחרים
- `runOnce` נעול ב-`running` כדי למנוע חפיפת סבבים; `lastRunSlot` מונע ריצה כפולה באותו סלוט
- כשל בגאנט אחד לא עוצר את השאר
- כל שינוי נרשם ללוג: `action: 'jira_auto_status'` עם `לפני → אחרי`

⚠️ `statusToValue` ב-`jira-scheduler.js` חייב להישאר תואם ל-`jiraStatusToValue` שב-`sprint.html`/`monthly.html` — אחרת ייווצרו ערכי סטטוס שאין להם תווית בממשק.

---

## .gitignore (מה לא עולה)

```
node_modules/
data/workgant.db + WAL
logs/
.env
data/smtp-config.json
data/jira-tokens.json
test-reports/
```

---

## Test Suite

**קובץ:** `test_suite.js`
**כמות בדיקות:** 119

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
