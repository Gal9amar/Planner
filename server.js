require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { router: authRouter, authenticate, requireEditor, requireAdmin } = require('./auth');
const logger = require('./logger');

const app = express();
const PORT = Number(process.env.PORT) || 3020;
const HOST = process.env.HOST || 'localhost';

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : [];

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));
app.use(express.json());
app.use('/workgant', express.static(path.join(__dirname)));

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.use('/workgant/api/auth', authRouter);

// Helper: בדוק אם user מורשה לגנט (viewer/editor)
function hasGanttAccess(user, ganttId, categoryId) {
  if (user.role === 'superadmin' || user.role === 'admin') return true;
  const ganttPerm = db.prepare(`SELECT 1 FROM user_gantt_permissions WHERE user_id=? AND gantt_id=?`).get(user.sub, ganttId);
  const catPerm   = db.prepare(`SELECT 1 FROM user_category_permissions WHERE user_id=? AND category_id=?`).get(user.sub, categoryId);
  return !!(ganttPerm || catPerm);
}


// ─── Categories ───────────────────────────────────────────────────────────────

// GET /workgant/api/categories → כל הקטגוריות + גאנטים תחתיהן (מסונן לצופה)
app.get('/workgant/api/categories', authenticate, (req, res) => {
  const categories = db.prepare(
    `SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, id`
  ).all();

  const gantts = db.prepare(
    `SELECT * FROM gantts WHERE deleted_at IS NULL ORDER BY sort_order, id`
  ).all();

  // viewer/editor — רק גאנטים שהורשה (ספציפי או דרך קטגוריה שלמה)
  let allowedGanttIds = null;
  let allowedCatIds   = null;
  if (req.user.role === 'viewer' || req.user.role === 'editor') {
    const ganttRows = db.prepare(`SELECT gantt_id FROM user_gantt_permissions WHERE user_id=?`).all(req.user.sub);
    const catRows   = db.prepare(`SELECT category_id FROM user_category_permissions WHERE user_id=?`).all(req.user.sub);
    allowedGanttIds = new Set(ganttRows.map(r => r.gantt_id));
    allowedCatIds   = new Set(catRows.map(r => r.category_id));
  }

  const result = categories.map(cat => ({
    ...cat,
    gantts: gantts.filter(g =>
      g.category_id === cat.id &&
      (allowedGanttIds === null ||
       allowedGanttIds.has(g.id) ||
       allowedCatIds.has(g.category_id))
    ),
  })).filter(cat => allowedGanttIds === null || cat.gantts.length > 0);

  res.json(result);
});

// POST /workgant/api/categories/reorder → [{ id, sort_order }]
app.post('/workgant/api/categories/reorder', authenticate, requireAdmin, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  const upd = db.prepare(`UPDATE categories SET sort_order = ? WHERE id = ?`);
  const tx = db.transaction(() => order.forEach(({ id, sort_order }) => upd.run(sort_order, id)));
  tx();
  res.json({ ok: true });
});

// POST /workgant/api/categories → צור קטגוריה חדשה
app.post('/workgant/api/categories', authenticate, requireAdmin, (req, res) => {
  const { name, type } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });

  const maxOrder = db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) as m FROM categories WHERE deleted_at IS NULL`
  ).get().m;

  const info = db.prepare(
    `INSERT INTO categories (name, type, sort_order) VALUES (?, ?, ?)`
  ).run(name, type, maxOrder + 1);

  const cat = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(info.lastInsertRowid);
  res.json({ ...cat, gantts: [] });
});

// PATCH /workgant/api/categories/:id → שנה שם
app.patch('/workgant/api/categories/:id', authenticate, requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  db.prepare(`UPDATE categories SET name = ? WHERE id = ? AND deleted_at IS NULL`).run(name, req.params.id);
  const cat = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(req.params.id);
  res.json(cat);
});

// DELETE /workgant/api/categories/:id → soft delete (רק אם ריקה)
app.delete('/workgant/api/categories/:id', authenticate, requireAdmin, (req, res) => {
  const hasGantts = db.prepare(
    `SELECT COUNT(*) as c FROM gantts WHERE category_id = ? AND deleted_at IS NULL`
  ).get(req.params.id).c;

  if (hasGantts > 0) return res.status(400).json({ error: 'category has gantts' });

  db.prepare(`UPDATE categories SET deleted_at = datetime('now') WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ─── Gantts ───────────────────────────────────────────────────────────────────

// GET /workgant/api/gantts/:id → state מלא
app.get('/workgant/api/gantts/:id', authenticate, (req, res) => {
  const gantt = db.prepare(`SELECT * FROM gantts WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
  if (!gantt) return res.status(404).json({ error: 'not found' });

  // viewer/editor — בדוק הרשאה (ספציפי או קטגוריה שלמה)
  if (req.user.role === 'viewer' || req.user.role === 'editor') {
    if (!hasGanttAccess(req.user, gantt.id, gantt.category_id))
      return res.status(403).json({ error: 'forbidden' });
  }

  const roles     = db.prepare(`SELECT * FROM roles     WHERE gantt_id = ? ORDER BY sort_order, id`).all(gantt.id);
  const employees = db.prepare(`SELECT * FROM employees WHERE gantt_id = ? ORDER BY sort_order, id`).all(gantt.id);
  const tasks     = db.prepare(`SELECT * FROM tasks     WHERE gantt_id = ? ORDER BY sort_order, id`).all(gantt.id);
  const sprints   = db.prepare(`SELECT * FROM sprints   WHERE gantt_id = ? ORDER BY sort_order, id`).all(gantt.id);

  const sprintIds = sprints.map(s => s.id);
  const sprintItems = sprintIds.length
    ? db.prepare(
        `SELECT * FROM sprint_items WHERE sprint_id IN (${sprintIds.map(() => '?').join(',')}) ORDER BY sort_order, id`
      ).all(...sprintIds)
    : [];

  const sprintsWithItems = sprints.map(s => ({
    ...s,
    items: sprintItems.filter(si => si.sprint_id === s.id)
  }));

  const parseJson = (obj, keys) => {
    const out = { ...obj };
    for (const k of keys) {
      if (out[k]) try { out[k] = JSON.parse(out[k]); } catch {}
    }
    return out;
  };

  res.json({
    ...parseJson(gantt, ['workdays_base']),
    roles,
    employees: employees.map(e => parseJson(e, ['vacation_json','hours_override_json','workdays_json','day_off_json'])),
    tasks: tasks.map(t => parseJson(t, ['months_json','days_json','qa_months_json'])),
    sprints: sprintsWithItems
  });
});

// POST /workgant/api/gantts → צור גאנט חדש
app.post('/workgant/api/gantts', authenticate, requireEditor, (req, res) => {
  const { category_id, name, type, year, month } = req.body;
  if (!category_id || !name || !type) return res.status(400).json({ error: 'category_id, name, type required' });

  // editor — רק אם יש לו הרשאה לאותה קטגוריה (דרך גנט קיים בה או קטגוריה ישירה)
  if (req.user.role === 'editor') {
    const catPerm   = db.prepare(`SELECT 1 FROM user_category_permissions WHERE user_id=? AND category_id=?`).get(req.user.sub, category_id);
    const ganttInCat = db.prepare(
      `SELECT 1 FROM user_gantt_permissions ugp JOIN gantts g ON g.id=ugp.gantt_id WHERE ugp.user_id=? AND g.category_id=? AND g.deleted_at IS NULL`
    ).get(req.user.sub, category_id);
    if (!catPerm && !ganttInCat) return res.status(403).json({ error: 'forbidden', message: 'אין הרשאה ליצור גאנט בבורד זה' });
  }

  const maxOrder = db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) as m FROM gantts WHERE category_id = ? AND deleted_at IS NULL`
  ).get(category_id).m;

  const info = db.prepare(
    `INSERT INTO gantts (category_id, name, type, year, month, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(category_id, name, type, year ?? null, month ?? null, maxOrder + 1);

  const newGanttId = info.lastInsertRowid;

  // editor — auto-permission לגנט החדש
  if (req.user.role === 'editor') {
    db.prepare(`INSERT OR IGNORE INTO user_gantt_permissions (user_id, gantt_id) VALUES (?, ?)`).run(req.user.sub, newGanttId);
  }

  const gantt = db.prepare(`SELECT * FROM gantts WHERE id = ?`).get(newGanttId);
  logger.log({ user: req.user, action: 'create_gantt', entityType: 'gantt', entityId: newGanttId, entityName: name, ip: req.ip });
  res.json(gantt);
});

// PATCH /workgant/api/gantts/:id → שנה שם
app.patch('/workgant/api/gantts/:id', authenticate, requireEditor, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  const gantt = db.prepare(`SELECT * FROM gantts WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
  if (!gantt) return res.status(404).json({ error: 'not found' });

  if (req.user.role === 'editor' && !hasGanttAccess(req.user, gantt.id, gantt.category_id))
    return res.status(403).json({ error: 'forbidden' });

  db.prepare(`UPDATE gantts SET name = ? WHERE id = ? AND deleted_at IS NULL`).run(name, req.params.id);
  logger.log({ user: req.user, action: 'rename_gantt', entityType: 'gantt', entityId: gantt.id, entityName: name, ip: req.ip });
  res.json(db.prepare(`SELECT * FROM gantts WHERE id = ?`).get(req.params.id));
});

// DELETE /workgant/api/gantts/:id → soft delete + cascade hard delete (admin/superadmin only)
app.delete('/workgant/api/gantts/:id', authenticate, (req, res) => {
  if (req.user.role === 'editor') return res.status(403).json({ error: 'forbidden', message: 'עורך אינו יכול למחוק גאנט' });
  if (req.user.role === 'viewer') return res.status(403).json({ error: 'forbidden' });

  const ganttId = req.params.id;
  const gantt = db.prepare(`SELECT * FROM gantts WHERE id = ?`).get(ganttId);
  const deleteAll = db.transaction(() => {
    const sprints = db.prepare(`SELECT id FROM sprints WHERE gantt_id = ?`).all(ganttId);
    if (sprints.length) {
      db.prepare(
        `DELETE FROM sprint_items WHERE sprint_id IN (${sprints.map(() => '?').join(',')})`
      ).run(...sprints.map(s => s.id));
    }
    db.prepare(`DELETE FROM sprints     WHERE gantt_id = ?`).run(ganttId);
    db.prepare(`DELETE FROM tasks       WHERE gantt_id = ?`).run(ganttId);
    db.prepare(`DELETE FROM employees   WHERE gantt_id = ?`).run(ganttId);
    db.prepare(`DELETE FROM roles       WHERE gantt_id = ?`).run(ganttId);
    db.prepare(`UPDATE gantts SET deleted_at = datetime('now') WHERE id = ?`).run(ganttId);
  });
  deleteAll();
  logger.log({ user: req.user, action: 'delete_gantt', entityType: 'gantt', entityId: ganttId, entityName: gantt?.name, ip: req.ip });
  res.json({ ok: true });
});

// PATCH /workgant/api/gantts/:id/state → שמור state מלא
app.patch('/workgant/api/gantts/:id/state', authenticate, requireEditor, (req, res) => {
  const ganttMeta = db.prepare(`SELECT * FROM gantts WHERE id = ? AND deleted_at IS NULL`).get(req.params.id);
  if (!ganttMeta) return res.status(404).json({ error: 'not found' });
  if (req.user.role === 'editor' && !hasGanttAccess(req.user, ganttMeta.id, ganttMeta.category_id))
    return res.status(403).json({ error: 'forbidden' });
  const ganttId = Number(req.params.id);
  const { gantt, roles, employees, tasks, sprints } = req.body;

  const saveState = db.transaction(() => {
    if (gantt) {
      db.prepare(`
        UPDATE gantts SET name=?, year=?, month=?, hours_per_day=?, workdays_base=?,
          sprint_start=?, sprint_end=?, freeze_date=?
        WHERE id=?
      `).run(
        gantt.name ?? null,
        gantt.year ?? null,
        gantt.month ?? null,
        gantt.hours_per_day ?? 8.5,
        gantt.workdays_base ? JSON.stringify(gantt.workdays_base) : null,
        gantt.sprint_start ?? null,
        gantt.sprint_end   ?? null,
        gantt.freeze_date  ?? null,
        ganttId
      );
    }

    if (roles !== undefined) {
      db.prepare(`DELETE FROM roles WHERE gantt_id = ?`).run(ganttId);
      const insRole = db.prepare(`INSERT INTO roles (gantt_id, name, sort_order) VALUES (?, ?, ?)`);
      roles.forEach((r, i) => insRole.run(ganttId, r.name, i));
    }

    if (employees !== undefined) {
      db.prepare(`DELETE FROM employees WHERE gantt_id = ?`).run(ganttId);
      const insEmp = db.prepare(`
        INSERT INTO employees (gantt_id, name, team, vacation_json, hours_override_json, workdays_json, day_off_json, hours_per_day_override, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      employees.forEach((e, i) => insEmp.run(
        ganttId, e.name, e.team ?? '',
        e.vacation_json       ? JSON.stringify(e.vacation_json)       : null,
        e.hours_override_json ? JSON.stringify(e.hours_override_json) : null,
        e.workdays_json       ? JSON.stringify(e.workdays_json)       : null,
        e.day_off_json        ? JSON.stringify(e.day_off_json)        : null,
        e.hours_per_day_override ?? 0,
        i
      ));
    }

    if (tasks !== undefined) {
      db.prepare(`DELETE FROM tasks WHERE gantt_id = ?`).run(ganttId);
      const insTask = db.prepare(`
        INSERT INTO tasks (gantt_id, name, task_number, owner, type, planned, qa_planned, months_json, qa_months_json, days_json, notes, status, start_day, priority, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      tasks.forEach((t, i) => insTask.run(
        ganttId, t.name, t.task_number ?? '', t.owner ?? '', t.type ?? '', t.planned ?? '0',
        Number(t.qa_planned) || 0,
        t.months_json    ? JSON.stringify(t.months_json)    : null,
        t.qa_months_json ? JSON.stringify(t.qa_months_json) : null,
        t.days_json      ? JSON.stringify(t.days_json)      : null,
        t.notes ?? '', t.status ?? 'pending', t.start_day ?? null,
        t.priority != null && t.priority !== '' ? Number(t.priority) : null,
        i
      ));
    }

    if (sprints !== undefined) {
      const oldSprints = db.prepare(`SELECT id FROM sprints WHERE gantt_id = ?`).all(ganttId);
      if (oldSprints.length) {
        db.prepare(
          `DELETE FROM sprint_items WHERE sprint_id IN (${oldSprints.map(() => '?').join(',')})`
        ).run(...oldSprints.map(s => s.id));
      }
      db.prepare(`DELETE FROM sprints WHERE gantt_id = ?`).run(ganttId);

      const insSprint = db.prepare(`INSERT INTO sprints (gantt_id, name, dates, sort_order) VALUES (?, ?, ?, ?)`);
      const insItem   = db.prepare(`INSERT INTO sprint_items (sprint_id, task_name, type, plan, done, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);

      sprints.forEach((s, i) => {
        const { lastInsertRowid: sid } = insSprint.run(ganttId, s.name, s.dates ?? '', i);
        (s.items ?? []).forEach((it, j) => insItem.run(sid, it.task_name ?? '', it.type ?? '', it.plan ?? 0, it.done ?? 0, j));
      });
    }
  });

  try {
    saveState();
    logger.log({ user: req.user, action: 'save_gantt', entityType: 'gantt', entityId: ganttMeta.id, entityName: ganttMeta.name, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    logger.logError({ error: err, path: req.path, method: req.method, user: req.user, ip: req.ip });
    res.status(500).json({ error: err.message });
  }
});

// ─── Teams ────────────────────────────────────────────────────────────────────

function getTeamsWithMembers() {
  const teams = db.prepare(`SELECT * FROM teams ORDER BY sort_order, id`).all();
  const members = db.prepare(`SELECT * FROM team_members ORDER BY sort_order, id`).all();
  return teams.map(t => ({ ...t, members: members.filter(m => m.team_id === t.id) }));
}

// GET /workgant/api/teams
app.get('/workgant/api/teams', authenticate, (req, res) => {
  res.json(getTeamsWithMembers());
});

// POST /workgant/api/teams
app.post('/workgant/api/teams', authenticate, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order),0) as m FROM teams`).get().m;
  const info = db.prepare(`INSERT INTO teams (name, sort_order) VALUES (?, ?)`).run(name.trim(), maxOrder + 1);
  res.json({ ...db.prepare(`SELECT * FROM teams WHERE id=?`).get(info.lastInsertRowid), members: [] });
});

// PATCH /workgant/api/teams/:id
app.patch('/workgant/api/teams/:id', authenticate, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare(`UPDATE teams SET name=? WHERE id=?`).run(name.trim(), req.params.id);
  res.json(getTeamsWithMembers().find(t => t.id === Number(req.params.id)));
});

// DELETE /workgant/api/teams/:id
app.delete('/workgant/api/teams/:id', authenticate, (req, res) => {
  db.prepare(`DELETE FROM teams WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// POST /workgant/api/teams/:id/members
app.post('/workgant/api/teams/:id/members', authenticate, (req, res) => {
  const { name, role } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const maxOrder = db.prepare(`SELECT COALESCE(MAX(sort_order),0) as m FROM team_members WHERE team_id=?`).get(req.params.id).m;
  const info = db.prepare(`INSERT INTO team_members (team_id, name, role, sort_order) VALUES (?,?,?,?)`).run(req.params.id, name.trim(), (role||'').trim(), maxOrder + 1);
  res.json(db.prepare(`SELECT * FROM team_members WHERE id=?`).get(info.lastInsertRowid));
});

// PATCH /workgant/api/teams/:id/members/:mid
app.patch('/workgant/api/teams/:id/members/:mid', authenticate, (req, res) => {
  const { name, role } = req.body;
  if (name !== undefined) db.prepare(`UPDATE team_members SET name=? WHERE id=? AND team_id=?`).run(name.trim(), req.params.mid, req.params.id);
  if (role !== undefined) db.prepare(`UPDATE team_members SET role=? WHERE id=? AND team_id=?`).run(role.trim(), req.params.mid, req.params.id);
  res.json(db.prepare(`SELECT * FROM team_members WHERE id=?`).get(req.params.mid));
});

// DELETE /workgant/api/teams/:id/members/:mid
app.delete('/workgant/api/teams/:id/members/:mid', authenticate, (req, res) => {
  db.prepare(`DELETE FROM team_members WHERE id=? AND team_id=?`).run(req.params.mid, req.params.id);
  res.json({ ok: true });
});

// GET /workgant/api/annual-gantts/all-with-tasks → כל הגאנטים השנתיים + שמות המשימות (ללא סינון הרשאות — ייבוא בלבד)
app.get('/workgant/api/annual-gantts/all-with-tasks', authenticate, (req, res) => {
  try {
    const annualGantts = db.prepare(
      `SELECT g.id, g.name, g.category_id, c.name as category_name
       FROM gantts g
       LEFT JOIN categories c ON c.id = g.category_id AND c.deleted_at IS NULL
       WHERE g.type = 'annual' AND g.deleted_at IS NULL
       ORDER BY c.sort_order, g.sort_order, g.id`
    ).all();

    const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all().map(c => c.name);
    const nameCol = taskCols.includes('task_name') ? 'task_name' : (taskCols.includes('name') ? 'name' : null);

    const result = annualGantts.map(g => {
      const tasks = nameCol
        ? db.prepare(`SELECT id, ${nameCol} as task_name FROM tasks WHERE gantt_id = ? AND ${nameCol} != '' ORDER BY sort_order, id`).all(g.id)
        : [];
      return { id: g.id, name: g.name, category_name: g.category_name, tasks };
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.logError({ error: err, path: req.path, method: req.method, user: req.user, ip: req.ip });
  res.status(500).json({ error: 'server_error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => {
  console.log(`WorkGant server running on http://${HOST}:${PORT}/workgant`);
});
