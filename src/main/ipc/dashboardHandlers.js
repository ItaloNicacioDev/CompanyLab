/**
 * dashboardHandlers.js
 *
 * Handler IPC do painel geral (seção 20 do spec). dashboard:getData já
 * é chamado pelo renderer.js atual — o formato de retorno bate exatamente
 * com o que ele espera (activeAgents, inProgressTasks, projects,
 * departments, recentActivity[]).
 *
 * O feed de atividade lê de `activity_log`, que outros handlers (por
 * enquanto só chatHandlers.js) alimentam ao logar ações reais — nunca
 * é gerado aqui.
 */

const { all } = require("../../../backend/database/db");

function safeParseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** @param {import('electron').IpcMain} ipcMain */
function registerDashboardHandlers(ipcMain) {
  ipcMain.handle("dashboard:getData", async () => {
    const [{ activeAgents }] = await all("SELECT COUNT(*) as activeAgents FROM agents");
    const [{ inProgressTasks }] = await all(
      "SELECT COUNT(*) as inProgressTasks FROM tasks WHERE status = 'in_progress'"
    );
    const [{ projects }] = await all("SELECT COUNT(*) as projects FROM projects WHERE status != 'completed'");
    const [{ departments }] = await all("SELECT COUNT(*) as departments FROM departments");

    const activityRows = await all("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 20");
    const recentActivity = activityRows.map((row) => ({
      type: row.action,
      timestamp: row.created_at,
      agentId: row.agent_id,
      message: safeParseJSON(row.metadata, {}),
    }));

    return { activeAgents, inProgressTasks, projects, departments, recentActivity };
  });
}

module.exports = registerDashboardHandlers;