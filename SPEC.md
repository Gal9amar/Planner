# WorkGant — מסמך אפיון מלא

## תוכן עניינים

1. [סקירה כללית](#סקירה-כללית)
2. [ארכיטקטורה](#ארכיטקטורה)
3. [מסד הנתונים](#מסד-הנתונים)
4. [שרת — API Routes](#שרת--api-routes)
5. [מערכת הרשאות ואימות](#מערכת-הרשאות-ואימות)
6. [index.html — דף הבית](#indexhtml--דף-הבית)
7. [annual.html — גאנט שנתי](#annualhtml--גאנט-שנתי)
8. [monthly.html — גאנט חודשי](#monthlyhtml--גאנט-חודשי)
9. [sprint.html — גאנט ספרינט](#sprinthtml--גאנט-ספרינט)
10. [תבניות משותפות בין גאנטים](#תבניות-משותפות-בין-גאנטים)
11. [.gitignore](#gitignore)
12. [הרצה ופריסה](#הרצה-ופריסה)

---

## סקירה כללית

**WorkGant** הוא כלי ניהול גאנט פנימי לצוות פיתוח. מאפשר תכנון עבודה שנתי, חודשי וספרינטים, עם ניהול כוח אדם, מעקב התקדמות ומשימות.

| פרט | ערך |
|---|---|
| שפה | עברית (RTL) |
| Stack | Node.js + Express (backend), React + Babel (inline, ללא bundler) |
| DB | SQLite דרך `better-sqlite3` |
| Port | `3011` (ברירת מחדל) |
| URL בסיס | `http://localhost:3011/workgant` |
| Auth | JWT (Access Token קצר + Refresh Token ארוך) |

---

## ארכיטקטורה

```
workgant/
├── server.js          Express app — כל ה-API routes
├── db.js              schema + seed + migrations אוטומטיות
├── auth.js            JWT middleware, login/refresh/logout routes
├── logger.js          audit log לקובץ + DB
├── index.html         דף הבית — ניהול קטגוריות וגאנטים
├── annual.html        גאנט שנתי (React inline)
├── monthly.html       גאנט חודשי (React inline)
├── sprint.html        גאנט ספרינט (React inline)
├── data/
│   └── workgant.db    SQLite database
├── logs/              קבצי לוג יומיים (YYYY-MM-DD.log) — מוחרג מ-git
└── package.json
```

### מודל הרינדור

כל גאנט הוא קובץ HTML עצמאי עם React 18 + ReactDOM + Babel המוטענים מ-CDN. אין bundler. הקוד כתוב ב-JSX inline שמתורגם ב-browser על-ידי Babel standalone.

**זרימת נתונים:**
```
mount → GET /workgant/api/gantts/:id
      → apiStateToAppState() → useReducer(state)
      → render

שינוי → dispatch(action) → reducer → new state
      → useEffect (debounce 800ms) → PATCH /workgant/api/gantts/:id/state
      → appStateToPayload() → server → SQLite
```

---

## מסד הנתונים

**קובץ:** `data/workgant.db`
**הגדרות:** `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`

### טבלאות נתוני גאנט

#### `categories`
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `name` | TEXT | שם הקטגוריה/בורד |
| `type` | TEXT | `annual` / `monthly` / `sprint` |
| `sort_order` | INTEGER | סדר תצוגה |
| `created_at` | TEXT | |
| `deleted_at` | TEXT | soft delete |

#### `gantts`
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `category_id` | INTEGER FK | → categories |
| `name` | TEXT | שם הגאנט |
| `type` | TEXT | `annual` / `monthly` / `sprint` |
| `year` | INTEGER | שנה (annual/monthly) |
| `month` | INTEGER | חודש 0-11 (monthly) |
| `hours_per_day` | REAL | שעות עבודה ביום (ברירת מחדל 8.5) |
| `workdays_base` | TEXT JSON | מערך 12 ערכים — ימי עבודה לחודש |
| `sprint_start` | TEXT | תאריך התחלת ספרינט (ISO) |
| `sprint_end` | TEXT | תאריך סיום ספרינט (ISO) |
| `freeze_date` | TEXT | תאריך הקפאה — ימים אחריו מודגשים בכחול |
| `sort_order` | INTEGER | |
| `created_at` | TEXT | |
| `deleted_at` | TEXT | soft delete |

#### `roles`
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `gantt_id` | INTEGER FK | → gantts (CASCADE DELETE) |
| `name` | TEXT | שם תפקיד (פיתוח, בודק, וכו') |
| `sort_order` | INTEGER | |

> **הערה:** לגאנט שנתי, roles מכיל גם `__type__:<name>` לסוגי משימות ו-`__setting__:<key>=<value>` להגדרות חישוב.

#### `employees`
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `gantt_id` | INTEGER FK | → gantts (CASCADE DELETE) |
| `name` | TEXT | שם עובד |
| `team` | TEXT | תפקיד/צוות |
| `vacation_json` | TEXT JSON | מערך חופשה — annual: 12 ערכים (ימים), monthly/sprint: N ערכים (ימים) |
| `hours_override_json` | TEXT JSON | עקיפת שעות — annual: 12, monthly/sprint: N (לפי ימי חודש/ספרינט) |
| `workdays_json` | TEXT JSON | ימי עבודה — annual: 12 ערכים |
| `day_off_json` | TEXT JSON | ימי חופש — monthly/sprint: מערך boolean לפי ימי טווח |
| `hours_per_day_override` | REAL | עקיפת שעות יומיות (0 = לא פעיל) |
| `sort_order` | INTEGER | |

#### `tasks`
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `gantt_id` | INTEGER FK | → gantts (CASCADE DELETE) |
| `name` | TEXT | שם המשימה |
| `task_number` | TEXT | מספר משימה חיצוני (CUS-200 וכו') |
| `owner` | TEXT | מוביל (annual בלבד) |
| `type` | TEXT | סוג משימה (פרויקט / תשתית / שוטף / באגים) |
| `planned` | TEXT | תכנון שעות (מספר או `?`) |
| `months_json` | TEXT JSON | מערך 12 שעות לחודש (annual בלבד) |
| `days_json` | TEXT JSON | מערך שעות ליום (monthly/sprint) |
| `notes` | TEXT | הערות |
| `status` | TEXT | סטטוס (monthly/sprint) — ברירת מחדל `pending` |
| `start_day` | INTEGER | יום התחלה (monthly/sprint) |
| `priority` | INTEGER | תיעדוף ייחודי — 1,2,3... (annual בלבד) |
| `sort_order` | INTEGER | סדר תצוגה (נשמר לפי מיקום במערך) |

#### `sprints` (לוח ספרינטים בגאנט)
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `gantt_id` | INTEGER FK | → gantts (CASCADE DELETE) |
| `name` | TEXT | שם הספרינט |
| `dates` | TEXT | תאריכים (טקסט חופשי) |
| `sort_order` | INTEGER | |

#### `sprint_items`
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `sprint_id` | INTEGER FK | → sprints (CASCADE DELETE) |
| `task_name` | TEXT | שם המשימה |
| `type` | TEXT | שוטף / פרויקט וכו' |
| `plan` | REAL | שעות מתוכננות |
| `done` | REAL | שעות שבוצעו |
| `sort_order` | INTEGER | |

#### `teams` / `team_members`
| עמודה | תיאור |
|---|---|
| `teams.id/name/sort_order` | קבוצות עובדים גלובליות (לכל הגאנטים) |
| `team_members.team_id/name/role/sort_order` | חברי הצוות |

### טבלאות Auth

#### `users`
| עמודה | טיפוס | תיאור |
|---|---|---|
| `id` | INTEGER PK | |
| `email` | TEXT UNIQUE | (case-insensitive) |
| `password_hash` | TEXT | bcrypt |
| `role` | TEXT | `superadmin` / `admin` / `editor` / `viewer` |
| `is_active` | INTEGER | 1/0 |
| `created_at` | TEXT | |
| `last_login` | TEXT | |
| `created_by` | INTEGER FK | → users |

#### `user_gantt_permissions`
הרשאת גישה לגאנט ספציפי: `(user_id, gantt_id)` PK

#### `user_category_permissions`
הרשאת גישה לכל הגאנטים בקטגוריה: `(user_id, category_id)` PK

#### `refresh_tokens`
| עמודה | תיאור |
|---|---|
| `token_hash` | hash של ה-refresh token |
| `expires_at` | תפוגה |
| `revoked_at` | ביטול |
| `ip / user_agent` | מידע סשן |

#### `login_attempts`
מעקב ניסיונות כניסה (לצורך rate limiting עתידי).

#### `audit_logs`
| עמודה | תיאור |
|---|---|
| `action` | create_gantt / save_gantt / rename_gantt / delete_gantt וכו' |
| `entity_type / entity_id / entity_name` | מה הושפע |
| `details / error` | JSON / טקסט |
| `ip` | כתובת IP |

---

## שרת — API Routes

**Base path:** `/workgant/api`
**Auth:** כל route דורש JWT ב-header `Authorization: Bearer <token>` (למעט `/auth/login`, `/auth/refresh`).

### Auth

| Method | Path | תיאור |
|---|---|---|
| POST | `/auth/login` | קבלת access + refresh tokens |
| POST | `/auth/refresh` | חידוש access token |
| POST | `/auth/logout` | ביטול refresh token |
| GET | `/auth/me` | פרטי המשתמש הנוכחי |
| GET | `/auth/users` | רשימת משתמשים (admin+) |
| POST | `/auth/users` | יצירת משתמש (admin+) |
| PATCH | `/auth/users/:id` | עדכון משתמש (admin+) |
| DELETE | `/auth/users/:id` | מחיקת משתמש (admin+) |
| GET | `/auth/users/:id/permissions` | הרשאות משתמש (admin+) |
| PUT | `/auth/users/:id/permissions` | עדכון הרשאות (admin+) |
| GET | `/auth/audit-logs` | לוג ביקורת (admin+) |

### Categories

| Method | Path | הרשאה | תיאור |
|---|---|---|---|
| GET | `/categories` | viewer+ | כל הקטגוריות + גאנטים (מסונן לפי הרשאות) |
| POST | `/categories` | admin+ | צור קטגוריה |
| PATCH | `/categories/:id` | admin+ | שנה שם קטגוריה |
| DELETE | `/categories/:id` | admin+ | מחק קטגוריה (רק אם ריקה) |
| POST | `/categories/reorder` | admin+ | עדכן סדר קטגוריות |

### Gantts

| Method | Path | הרשאה | תיאור |
|---|---|---|---|
| GET | `/gantts/:id` | viewer+ | state מלא של גאנט |
| POST | `/gantts` | editor+ | צור גאנט חדש |
| PATCH | `/gantts/:id` | editor+ | שנה שם גאנט |
| DELETE | `/gantts/:id` | admin+ | מחק גאנט (cascade) |
| PATCH | `/gantts/:id/state` | editor+ | שמור state מלא (debounce 800ms מהבראוזר) |

### Teams

| Method | Path | תיאור |
|---|---|---|
| GET | `/teams` | כל הצוותים + חברים |
| POST | `/teams` | צור צוות |
| PATCH | `/teams/:id` | שנה שם צוות |
| DELETE | `/teams/:id` | מחק צוות (cascade members) |
| POST | `/teams/:id/members` | הוסף חבר |
| PATCH | `/teams/:id/members/:mid` | עדכן חבר |
| DELETE | `/teams/:id/members/:mid` | מחק חבר |

---

## מערכת הרשאות ואימות

### תפקידים

| תפקיד | יכולות |
|---|---|
| `superadmin` | גישה מלאה לכל, לא ניתן למחיקה |
| `admin` | ניהול מלא: קטגוריות, גאנטים, משתמשים, הרשאות |
| `editor` | קריאה + עריכה + יצירת גאנטים בקטגוריות מורשות |
| `viewer` | קריאה בלבד לגאנטים מורשים |

### מנגנון הרשאות לגאנטים

- **הרשאת קטגוריה** — גישה לכל הגאנטים בקטגוריה (`user_category_permissions`)
- **הרשאת גאנט ספציפי** — גישה לגאנט בודד (`user_gantt_permissions`)
- `superadmin` / `admin` — גישה לכל ללא בדיקה
- `editor` שיוצר גאנט מקבל auto-permission אליו

### JWT

- **Access Token:** חיי מדף קצרים (דקות) — נשלח בכל בקשה
- **Refresh Token:** חיי מדף ארוכים — נשמר ב-DB עם hash, ip, user_agent
- כניסה נכשלת נרשמת ב-`login_attempts`

---

## index.html — דף הבית

### מה הוא עושה

- מציג עמוד צד שמאל (sidebar) עם רשימת קטגוריות וגאנטים
- כפתור כניסה / פרטי משתמש
- פתיחת גאנט: `window.open('annual.html?ganttId=X')` ב-iframe מוטמע

### תצוגת sidebar

```
📁 קטגוריה שנתית
   └─ 📅 תוכנית 2026
   └─ 📅 תוכנית 2025

📁 קטגוריה ספרינטים
   └─ 🔁 ספרינט אפריל
```

### פעולות admin/editor

- **+ קטגוריה חדשה** (admin בלבד)
- **+ גאנט חדש** בתוך קטגוריה (editor+)
- **שנה שם / מחק** גאנט (drag-to-reorder קטגוריות — admin)
- **ניהול משתמשים** (admin)
- **ניהול צוותים** (כולם)

---

## annual.html — גאנט שנתי

### מסכים (Screens)

| Screen | תיאור |
|---|---|
| `dashboard` | גרפים: עוגת סוגי משימות, עמודות זמינות מפתחים/בודקים לפי חודש, חלוקת שעות לפי תפקיד |
| `tasks` | טבלת משימות + שורות סיכום |
| `manpower` | טבלת עובדים עם שעות זמינות, חופשות, override |
| `sprints` | לוח ספרינטים עם פריטי תכנון/ביצוע |
| `settings` | ניהול תפקידים, סוגי משימות |
| `help` | מדריך שימוש |

### מסך Tasks

**עמודות:**
- `⠿` — drag handle להזזת שורה
- תיעדוף — מספר ייחודי (1,2,3...). משימות עם תיעדוף מסודרות ראשונות ולא ניתנות לגרירה
- משימה — שם
- מוביל — בעלים
- סוג — dropdown מותאם אישית עם צבעים
- תכנון — שעות שנתיות (מספר או `?`)
- שיבוץ מלא — Pill ירוק/אדום/כתום
- ינואר–דצמבר — 12 עמודות חודשיות עם חסימה אוטומטית כשהתקציב מוצה
- סה"כ שורה
- הערות
- 🗑️ מחיקה

**שורות סיכום (tfoot, ניתנות לגרירה):**
- סה"כ שיבוץ חודשי
- סה"כ זמן נדרש (פיתוח + בודק%)
- זמינות מפתחים
- הפרש זמינות מפתחים
- זמני בדיקות (% מהמשימות)
- זמינות בודקים
- הפרש זמינות בודקים

**⚡ חלוקה אוטומטית:**
מחלק שעות למשימות מתועדפות לפי סדר תיעדוף ולפי זמינות מפתחים לכל חודש.

**פריטי תיעדוף:**
- מספר ייחודי בלבד
- לא ניתנים לגרירה (הסדר נקבע על-ידי המספר)
- אייקון `⠿` מוצג כ-transparent למשימות עם תיעדוף

### Reducer Actions (annual)

| Action | תיאור |
|---|---|
| `SET_TASK_FIELD` | עדכן שדה משימה |
| `SET_TASK_MONTH` | עדכן שעות חודשיות |
| `ADD_TASK` | הוסף משימה (אחרי משימות מתועדפות) |
| `DELETE_TASK` | מחק משימה |
| `REORDER_TASKS` | הזז משימה (fromIdx → toIdx) |
| `SET_TASK_PRIORITY` | עדכן תיעדוף + מיין מחדש |
| `AUTO_DISTRIBUTE` | החל חלוקה אוטומטית |
| `ADD_EMPLOYEE` | הוסף עובד |
| `DELETE_EMPLOYEE` | מחק עובד |
| `SET_EMP_FIELD` | עדכן שדה עובד |
| `SET_EMP_VACATION` | עדכן חופשה חודשית |
| `SET_EMP_HOURS_OVERRIDE` | עקיפת שעות חודשיות |
| `ADD_ROLE` / `DELETE_ROLE` | ניהול תפקידים |
| `ADD_TASK_TYPE` / `DELETE_TASK_TYPE` | ניהול סוגי משימות |
| `SET_SETTING` | הגדרות חישוב (dev_role, qa_role, qa_pct) |
| `ADD_SPRINT` / `DELETE_SPRINT` | ניהול ספרינטים |
| `SET_SPRINT_FIELD` / `SET_SPRINT_ITEM` | עדכון ספרינטים |
| `ADD_SPRINT_ITEM` / `DELETE_SPRINT_ITEM` | פריטי ספרינט |
| `ADD_EMPLOYEE_FROM_TEAM` | ייבוא עובד מצוות גלובלי |
| `SET_HOURS_PER_DAY` | שעות ביום |

### ייצוא Excel

כולל 4 גיליונות: Tasks, Summary, Manpower, Sprints.

---

## monthly.html — גאנט חודשי

### מסכים

| Screen | תיאור |
|---|---|
| `tasks` | טבלת משימות יומית |
| `manpower` | עובדים עם ימי חופש וזמינות יומית |
| `sprints` | לוח ספרינטים |
| `settings` | תפקידים, סוגי משימות, סטטוסים |
| `help` | מדריך |

### מסך Tasks

**עמודות:**
- `⠿` — drag handle
- משימה
- מס' משימה (CUS-200 וכו')
- סטטוס — dropdown עם צבעים מותאמים אישית + background צבעוני לשורה
- עובדים — multi-select מעובדי הגאנט
- סוג
- יום התחלה — dropdown ימי החודש (רק ימי עבודה)
- תכנון שעות
- יום 1 עד יום N — שעות יומיות עם חסימה כשתקציב מוצה, weekends אפורים
- התקדמות — progress bar + מספר שובץ/תוכנן, כפתור מחיקה

**שורות סיכום (tfoot):**
- סה"כ שיבוץ יומי
- משאבים זמינים (לפי תפקיד ראשי)
- הפרש שעות

### Reducer Actions (monthly)

כולל את כל actions הבסיסיים + :

| Action | תיאור |
|---|---|
| `SET_TASK_DAY` | עדכן שעות יומיות |
| `REORDER_TASKS` | גרירת משימות |
| `ADD_TASK_STATUS` / `DELETE_TASK_STATUS` | ניהול סטטוסים |
| `SET_EMP_DAY_OFF` | סימון יום חופש לעובד |
| `SET_EMP_HOURS_OVERRIDE` | עקיפת שעות ליום |

---

## sprint.html — גאנט ספרינט

### הבדלים מגאנט חודשי

| פרט | Monthly | Sprint |
|---|---|---|
| טווח תאריכים | חודש קלנדרי | `sprint_start` → `sprint_end` (כל טווח) |
| `freeze_date` | אין | ימים אחרי ה-freeze_date מודגשים בכחול (עתידיים) |
| עמודות ימים | לפי ימי חודש | לפי תאריכים בטווח הספרינט |
| כותרות ימים | 1/M, 2/M... | DD/MM (תאריך מלא) |

### מסך Tasks

זהה ל-monthly עם ההבדלים:
- ימי הטווח נקבעים על-ידי `sprint_start` / `sprint_end`
- עמודות לאחר `freeze_date` מוצגות עם רקע כחול (עתיד)
- "יום התחלה" = תאריך ISO בטווח הספרינט

### Meta של ספרינט

בהגדרות: שם, תאריך התחלה, תאריך סיום, תאריך הקפאה.

---

## תבניות משותפות בין גאנטים

### שמירה

- כל שינוי → dispatch → useEffect → debounce 800ms → `PATCH /workgant/api/gantts/:id/state`
- השמירה מחליפה את כל הנתונים בטרנזקציה (DELETE + re-INSERT)

### Column Resize

כל גאנט מממש `ResizableTh` — עמודות ניתנות לשינוי גודל בגרירה. הרוחבים נשמרים ב-localStorage:
- Annual: `workgant_annual_col_widths`
- Monthly: `workgant_monthly_col_widths`
- Sprint: `workgant_sprint_col_widths`

### Drag & Drop משימות

- כל שורת משימה `draggable`
- אייקון `⠿` (אפור, 20px) בצד ימין כ-handle חזותי
- שורת יעד מקבלת `outline outline-2 outline-indigo-400`
- Annual בלבד: משימות עם `priority !== null` — לא ניתנות לגרירה (handle שקוף)
- Action: `REORDER_TASKS { fromIdx, toIdx }`

### React Key

כל task מקבל `_uid` ייחודי (`t.id` מה-DB, או `Math.random().toString(36).slice(2)` לחדשים). משמש כ-`key` ב-`<tr>` למניעת re-render שגוי בעת reorder.

### Sticky Columns

- עמודת שם משימה: `position: sticky; right: 0`
- עמודת התקדמות (monthly/sprint): `position: sticky; left: 0`
- header ו-tfoot: `z-index: 3`

### Teams Panel

בכל גאנט קיים מסך "צוות" שמאפשר:
- הוספת צוותים גלובליים (שיתוף בין גאנטים)
- ייבוא עובד מצוות ישירות לגאנט (`ADD_EMPLOYEE_FROM_TEAM`)

---

## .gitignore

```
workgant/node_modules/
workgant/data/
workgant/.env
workgant/logs/
```

---

## הרצה ופריסה

### פיתוח

```bash
cd workgant
npm install
node server.js
# פתח http://localhost:3011/workgant
```

### משתני סביבה (`.env`)

| משתנה | תיאור | ברירת מחדל |
|---|---|---|
| `PORT` | פורט השרת | `3011` |
| `HOST` | כתובת האזנה | `localhost` |
| `DB_PATH` | נתיב ל-SQLite | `./data/workgant.db` |
| `JWT_SECRET` | סוד לחתימת tokens | חובה בייצור |
| `ALLOWED_ORIGINS` | CORS origins (פסיק-מופרד) | פתוח (dev) |

### ייצור

- DB נוצר אוטומטית עם `db.js` בהפעלה ראשונה
- Superadmin ברירת מחדל: `gal@finitione.com` (נוצר רק אם אין משתמשים)
- לוגים נכתבים ל-`logs/YYYY-MM-DD.log` ול-`audit_logs` בDB
