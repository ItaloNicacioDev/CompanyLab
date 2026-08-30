/**
 * projectHandlers.js
 *
 * Handlers IPC do domínio "projeto" (seção 13/15 do spec). Ainda não
 * é chamado pelo renderer.js atual (não existe tela de projetos
 * ainda), mas o backend já fica pronto.
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

function mapProjectRow(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    departments: safeParseJSON(row.departments, []),
    agents: safeParseJSON(row.agents, []),
    progress: row.progress,
    status: row.status,
    createdAt: row.created_at,
  };
}

/** @param {import('electron').IpcMain} ipcMain */
function registerProjectHandlers(ipcMain) {
  ipcMain.handle("project:getAll", async () => {
    const rows = await all("SELECT * FROM projects ORDER BY created_at DESC");
    return rows.map(mapProjectRow);
  });

  ipcMain.handle("project:getById", async (_event, projectId) => {
    const row = await get("SELECT * FROM projects WHERE id = ?", [projectId]);
    return row ? mapProjectRow(row) : null;
  });

  ipcMain.handle("project:create", async (_event, config = {}) => {
    if (!config.name) {
      return { success: false, error: "Nome do projeto é obrigatório." };
    }

    const companyId = await getDefaultCompanyId();
    const id = generateId("project");

    await run(
      `INSERT INTO projects (id, company_id, name, description, departments, agents, progress, status)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'active')`,
      [
        id,
        companyId,
        config.name,
        config.description || null,
        JSON.stringify(config.departments || []),
        JSON.stringify(config.agents || []),
      ]
    );

    const project = mapProjectRow(await get("SELECT * FROM projects WHERE id = ?", [id]));
    EventBus.emitEvent(EVENT_TYPES.PROJECT_CREATED, { project });
    return { success: true, project };
  });

  ipcMain.handle("project:update", async (_event, projectId, updates = {}) => {
    const current = await get("SELECT * FROM projects WHERE id = ?", [projectId]);
    if (!current) return { success: false, error: "Projeto não encontrado." };

    await run(
      `UPDATE projects SET name=?, description=?, departments=?, agents=?, progress=?, status=? WHERE id=?`,
      [
        updates.name ?? current.name,
        updates.description ?? current.description,
        updates.departments ? JSON.stringify(updates.departments) : current.departments,
        updates.agents ? JSON.stringify(updates.agents) : current.agents,
        updates.progress ?? current.progress,
        updates.status ?? current.status,
        projectId,
      ]
    );

    const project = mapProjectRow(await get("SELECT * FROM projects WHERE id = ?", [projectId]));
    EventBus.emitEvent(
      updates.status === "completed" ? EVENT_TYPES.PROJECT_COMPLETED : EVENT_TYPES.PROJECT_UPDATED,
      { project }
    );
    return { success: true, project };
  });

  ipcMain.handle("project:delete", async (_event, projectId) => {
    await run("DELETE FROM projects WHERE id = ?", [projectId]);
    return { success: true };
  });
}

module.exports = registerProjectHandlers;