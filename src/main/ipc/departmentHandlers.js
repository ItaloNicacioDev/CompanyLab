/**
 * departmentHandlers.js
 *
 * Handlers IPC do domínio "departamento". Canais department:getAll e
 * department:create já são chamados pelo renderer.js atual.
 *
 * NOTA DE SCHEMA: a tabela `departments` (001_initial.sql) ainda não
 * tem colunas dedicadas pra `tags`/`accentColor` (usadas pelo
 * room/RoomFactory.js pra decidir/colorir a sala 3D). Por enquanto
 * elas vivem dentro da coluna `rules`, como JSON:
 * `{ "tags": [...], "accentColor": "#3b82f6" }`. Se um dia isso virar
 * colunas próprias numa migration nova, só o parse aqui precisa mudar
 * — o resto do app já consome `department.tags`/`department.accentColor`
 * como campos normais.
 */

const { run, get, all } = require("../../../backend/database/db");
const { generateId } = require("../../../backend/utils/id.js");
const { getDefaultCompanyId } = require("../../../backend/database/defaultCompany");
const EventBus = require("../../../core/events/EventBus");
const { EVENT_TYPES } = require("../../../core/events/eventTypes");

function safeParseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapDepartmentRow(row, employeeCount) {
  const rules = safeParseJSON(row.rules, {});
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    roomType: row.room_type,
    tags: rules.tags || [],
    accentColor: rules.accentColor || null,
    employeeCount,
    // Compatibilidade com src/renderer/renderer.js atual, que faz
    // `dept.employees?.length` — troque por employeeCount quando o
    // renderer for atualizado pra usar o número direto.
    employees: Array.from({ length: employeeCount }),
    createdAt: row.created_at,
  };
}

/** @param {import('electron').IpcMain} ipcMain */
function registerDepartmentHandlers(ipcMain) {
  ipcMain.handle("department:getAll", async () => {
    const rows = await all(`
      SELECT d.*, (SELECT COUNT(*) FROM agents a WHERE a.department_id = d.id) as employee_count
      FROM departments d
      ORDER BY d.created_at ASC
    `);
    return rows.map((row) => mapDepartmentRow(row, row.employee_count));
  });

  ipcMain.handle("department:getById", async (_event, departmentId) => {
    const row = await get(
      `SELECT d.*, (SELECT COUNT(*) FROM agents a WHERE a.department_id = d.id) as employee_count
       FROM departments d WHERE d.id = ?`,
      [departmentId]
    );
    return row ? mapDepartmentRow(row, row.employee_count) : null;
  });

  ipcMain.handle("department:create", async (_event, config = {}) => {
    if (!config.name) {
      return { success: false, error: "Nome do departamento é obrigatório." };
    }

    const companyId = await getDefaultCompanyId();
    const id = config.id || generateId("dept");
    const rules = JSON.stringify({ tags: config.tags || [], accentColor: config.accentColor || null });

    await run(
      `INSERT INTO departments (id, company_id, name, description, icon, room_type, rules) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, companyId, config.name, config.description || null, config.icon || null, config.roomType || "generic", rules]
    );

    const row = await get("SELECT * FROM departments WHERE id = ?", [id]);
    const department = mapDepartmentRow(row, 0);

    EventBus.emitEvent(EVENT_TYPES.DEPARTMENT_CREATED, { department });
    return { success: true, department };
  });

  ipcMain.handle("department:update", async (_event, departmentId, updates = {}) => {
    const current = await get("SELECT * FROM departments WHERE id = ?", [departmentId]);
    if (!current) return { success: false, error: "Departamento não encontrado." };

    const currentRules = safeParseJSON(current.rules, {});
    const mergedRules = {
      tags: updates.tags ?? currentRules.tags ?? [],
      accentColor: updates.accentColor ?? currentRules.accentColor ?? null,
    };

    await run(
      `UPDATE departments SET name=?, description=?, icon=?, room_type=?, rules=? WHERE id=?`,
      [
        updates.name ?? current.name,
        updates.description ?? current.description,
        updates.icon ?? current.icon,
        updates.roomType ?? current.room_type,
        JSON.stringify(mergedRules),
        departmentId,
      ]
    );

    const countRow = await get("SELECT COUNT(*) as c FROM agents WHERE department_id = ?", [departmentId]);
    const row = await get("SELECT * FROM departments WHERE id = ?", [departmentId]);
    const department = mapDepartmentRow(row, countRow.c);

    EventBus.emitEvent(EVENT_TYPES.DEPARTMENT_UPDATED, { department });
    return { success: true, department };
  });

  ipcMain.handle("department:delete", async (_event, departmentId) => {
    await run("DELETE FROM departments WHERE id = ?", [departmentId]);
    EventBus.emitEvent(EVENT_TYPES.DEPARTMENT_DELETED, { departmentId });
    return { success: true };
  });
}

module.exports = registerDepartmentHandlers;