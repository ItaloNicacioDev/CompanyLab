/**
 * taskHandlers.js
 *
 * Handlers IPC do domínio "tarefa" (seção 14 do spec). task:getAll já
 * é chamado pelo renderer.js atual; os demais formam o CRUD completo
 * + transições de status, que já emitem os eventos corretos pro
 * dashboard/3D reagirem (seção 34).
 */

const { run, get, all } = require("../../../backend/database/db");
const { generateId } = require("../../../backend/utils/id.js");
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

function mapTaskRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    creatorId: row.creator_id,
    assignedToId: row.assigned_to,
    assignedTo: row.assigned_name || null, // nome legível, pro renderer.js atual
    departmentId: row.department_id,
    projectId: row.project_id,
    priority: row.priority,
    status: row.status,
    dependencies: safeParseJSON(row.dependencies, []),
    deadline: row.deadline,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TASK_WITH_ASSIGNEE_SQL = `
  SELECT t.*, a.name as assigned_name
  FROM tasks t
  LEFT JOIN agents a ON t.assigned_to = a.id
`;

/** Status -> evento de domínio correspondente (seção 34 do spec). */
const STATUS_EVENT_MAP = {
  in_progress: EVENT_TYPES.AGENT_TASK_STARTED,
  completed: EVENT_TYPES.AGENT_TASK_COMPLETED,
  failed: EVENT_TYPES.AGENT_TASK_FAILED,
  blocked: EVENT_TYPES.AGENT_TASK_BLOCKED,
};

/** @param {import('electron').IpcMain} ipcMain */
function registerTaskHandlers(ipcMain) {
  ipcMain.handle("task:getAll", async () => {
    const rows = await all(`${TASK_WITH_ASSIGNEE_SQL} ORDER BY t.created_at DESC`);
    return rows.map(mapTaskRow);
  });

  ipcMain.handle("task:getById", async (_event, taskId) => {
    const row = await get(`${TASK_WITH_ASSIGNEE_SQL} WHERE t.id = ?`, [taskId]);
    return row ? mapTaskRow(row) : null;
  });

  ipcMain.handle("task:create", async (_event, config = {}) => {
    if (!config.title) {
      return { success: false, error: "Título da tarefa é obrigatório." };
    }
    const id = generateId("task");

    await run(
      `INSERT INTO tasks (id, title, description, creator_id, assigned_to, department_id, project_id, priority, status, dependencies, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        id,
        config.title,
        config.description || null,
        config.creatorId || null,
        config.assignedTo || null,
        config.departmentId || null,
        config.projectId || null,
        config.priority || "medium",
        JSON.stringify(config.dependencies || []),
        config.deadline || null,
      ]
    );

    const task = mapTaskRow(await get(`${TASK_WITH_ASSIGNEE_SQL} WHERE t.id = ?`, [id]));
    EventBus.emitEvent(EVENT_TYPES.AGENT_TASK_CREATED, { task });
    if (task.assignedToId) EventBus.emitEvent(EVENT_TYPES.AGENT_TASK_ASSIGNED, { task });

    return { success: true, task };
  });

  ipcMain.handle("task:updateStatus", async (_event, taskId, status, result = null) => {
    await run("UPDATE tasks SET status = ?, result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [
      status,
      result,
      taskId,
    ]);

    const task = mapTaskRow(await get(`${TASK_WITH_ASSIGNEE_SQL} WHERE t.id = ?`, [taskId]));

    const eventType = STATUS_EVENT_MAP[status] || EVENT_TYPES.AGENT_TASK_UPDATED;
    EventBus.emitEvent(eventType, { task });

    // Reflete no avatar 3D do agente responsável (seção 25 do spec:
    // "If an agent completes a task -> its state changes").
    if (task.assignedToId) {
      if (status === "in_progress") EventBus.emitEvent(EVENT_TYPES.AGENT_WORKING, { agentId: task.assignedToId });
      if (status === "completed")
        EventBus.emitEvent(EVENT_TYPES.AGENT_TASK_COMPLETED, { agentId: task.assignedToId, task });
      if (status === "blocked") EventBus.emitEvent(EVENT_TYPES.AGENT_BLOCKED, { agentId: task.assignedToId });
    }

    return { success: true, task };
  });

  ipcMain.handle("task:update", async (_event, taskId, updates = {}) => {
    const current = await get("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (!current) return { success: false, error: "Tarefa não encontrada." };

    await run(
      `UPDATE tasks SET title=?, description=?, assigned_to=?, department_id=?, project_id=?, priority=?, dependencies=?, deadline=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [
        updates.title ?? current.title,
        updates.description ?? current.description,
        updates.assignedTo ?? current.assigned_to,
        updates.departmentId ?? current.department_id,
        updates.projectId ?? current.project_id,
        updates.priority ?? current.priority,
        updates.dependencies ? JSON.stringify(updates.dependencies) : current.dependencies,
        updates.deadline ?? current.deadline,
        taskId,
      ]
    );

    const task = mapTaskRow(await get(`${TASK_WITH_ASSIGNEE_SQL} WHERE t.id = ?`, [taskId]));
    EventBus.emitEvent(EVENT_TYPES.AGENT_TASK_UPDATED, { task });
    return { success: true, task };
  });

  ipcMain.handle("task:delete", async (_event, taskId) => {
    await run("DELETE FROM tasks WHERE id = ?", [taskId]);
    return { success: true };
  });
}

module.exports = registerTaskHandlers;