/**
 * agentHandlers.js
 *
 * Handlers IPC do domínio "agente". Os nomes de canal batem com o que
 * `src/renderer/renderer.js` JÁ chama hoje: agent:getAll, agent:create.
 * Os demais (getById, update, updateStatus, delete) são a base de CRUD
 * completo que a seção 19 do spec exige (usuário pode mudar role,
 * personalidade, permissões, runtime, remover agente, etc.) — a UI
 * pra eles ainda não existe, mas o backend já fica pronto.
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

/** Converte a linha crua do SQLite pro formato que o resto do app consome. */
function mapAgentRow(row) {
  return {
    id: row.id,
    companyId: row.company_id,
    departmentId: row.department_id,
    department: row.department_name || null,
    name: row.name,
    avatar: row.avatar,
    role: row.role,
    title: row.title,
    personality: safeParseJSON(row.personality, null),
    soul: row.soul,
    skills: safeParseJSON(row.skills, []),
    responsibilities: safeParseJSON(row.responsibilities, []),
    permissions: safeParseJSON(row.permissions, []),
    runtime: row.runtime,
    model: row.model,
    isCeo: !!row.is_ceo,
    status: row.status,
    createdAt: row.created_at,
  };
}

const AGENT_WITH_DEPARTMENT_SQL = `
  SELECT a.*, d.name as department_name
  FROM agents a
  LEFT JOIN departments d ON a.department_id = d.id
`;

/** @param {import('electron').IpcMain} ipcMain */
function registerAgentHandlers(ipcMain) {
  ipcMain.handle("agent:getAll", async () => {
    const rows = await all(`${AGENT_WITH_DEPARTMENT_SQL} ORDER BY a.created_at ASC`);
    return rows.map(mapAgentRow);
  });

  ipcMain.handle("agent:getById", async (_event, agentId) => {
    const row = await get(`${AGENT_WITH_DEPARTMENT_SQL} WHERE a.id = ?`, [agentId]);
    return row ? mapAgentRow(row) : null;
  });

  ipcMain.handle("agent:create", async (_event, config = {}) => {
    if (!config.name) {
      return { success: false, error: "Nome do agente é obrigatório." };
    }

    const companyId = await getDefaultCompanyId();
    const id = generateId("agent");

    await run(
      `INSERT INTO agents
        (id, company_id, department_id, name, avatar, role, title, personality, soul, skills, responsibilities, permissions, runtime, model, is_ceo, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        companyId,
        config.department || null,
        config.name,
        config.avatar || null,
        config.role || null,
        config.title || config.role || null,
        JSON.stringify(config.personality || {}),
        config.soul || null,
        JSON.stringify(config.skills || []),
        JSON.stringify(config.responsibilities || []),
        JSON.stringify(config.permissions || []),
        config.runtime || null,
        config.model || null,
        config.isCEO ? 1 : 0,
        "idle",
      ]
    );

    const agent = mapAgentRow(await get(`${AGENT_WITH_DEPARTMENT_SQL} WHERE a.id = ?`, [id]));
    EventBus.emitEvent(EVENT_TYPES.AGENT_CREATED, { agent });

    return { success: true, agent };
  });

  ipcMain.handle("agent:update", async (_event, agentId, updates = {}) => {
    const current = await get("SELECT * FROM agents WHERE id = ?", [agentId]);
    if (!current) return { success: false, error: "Agente não encontrado." };

    const merged = {
      department_id: updates.department ?? current.department_id,
      name: updates.name ?? current.name,
      avatar: updates.avatar ?? current.avatar,
      role: updates.role ?? current.role,
      title: updates.title ?? current.title,
      personality: updates.personality ? JSON.stringify(updates.personality) : current.personality,
      soul: updates.soul ?? current.soul,
      skills: updates.skills ? JSON.stringify(updates.skills) : current.skills,
      responsibilities: updates.responsibilities
        ? JSON.stringify(updates.responsibilities)
        : current.responsibilities,
      permissions: updates.permissions ? JSON.stringify(updates.permissions) : current.permissions,
      runtime: updates.runtime ?? current.runtime,
      model: updates.model ?? current.model,
      is_ceo: updates.isCEO !== undefined ? (updates.isCEO ? 1 : 0) : current.is_ceo,
    };

    await run(
      `UPDATE agents SET department_id=?, name=?, avatar=?, role=?, title=?, personality=?, soul=?, skills=?, responsibilities=?, permissions=?, runtime=?, model=?, is_ceo=?
       WHERE id=?`,
      [
        merged.department_id,
        merged.name,
        merged.avatar,
        merged.role,
        merged.title,
        merged.personality,
        merged.soul,
        merged.skills,
        merged.responsibilities,
        merged.permissions,
        merged.runtime,
        merged.model,
        merged.is_ceo,
        agentId,
      ]
    );

    const agent = mapAgentRow(await get(`${AGENT_WITH_DEPARTMENT_SQL} WHERE a.id = ?`, [agentId]));

    const departmentChanged =
      updates.department !== undefined && updates.department !== current.department_id;
    EventBus.emitEvent(
      departmentChanged ? EVENT_TYPES.AGENT_DEPARTMENT_CHANGED : EVENT_TYPES.AGENT_UPDATED,
      { agent }
    );

    return { success: true, agent };
  });

  ipcMain.handle("agent:updateStatus", async (_event, agentId, status) => {
    await run("UPDATE agents SET status = ? WHERE id = ?", [status, agentId]);

    const statusEventMap = {
      working: EVENT_TYPES.AGENT_WORKING,
      idle: EVENT_TYPES.AGENT_IDLE,
      blocked: EVENT_TYPES.AGENT_BLOCKED,
      error: EVENT_TYPES.AGENT_ERROR,
    };
    const eventType = statusEventMap[status];
    if (eventType) EventBus.emitEvent(eventType, { agentId, status });

    return { success: true };
  });

  ipcMain.handle("agent:delete", async (_event, agentId) => {
    await run("DELETE FROM agents WHERE id = ?", [agentId]);
    EventBus.emitEvent(EVENT_TYPES.AGENT_DELETED, { agentId });
    return { success: true };
  });
}

module.exports = registerAgentHandlers;