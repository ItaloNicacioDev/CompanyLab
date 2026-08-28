/**
 * eventTypes.js
 *
 * Catálogo central de todos os eventos que existem no CompanyLab.
 * Isso é o "vocabulário" que Chat, Tasks, Dashboards, Notificações,
 * o mundo 3D e os Agentes usam pra se manter sincronizados, todos
 * conversando através do mesmo EventBus (seção 34 do spec).
 *
 * REGRA: nenhuma parte do sistema deve inventar uma string de evento
 * solta no meio do código. Toda emissão de evento deve usar uma das
 * constantes daqui. Isso evita o bug clássico de "digitei
 * 'agent.stared' em vez de 'agent.started'" e o EventBus fica surdo.
 */

const EVENT_TYPES = Object.freeze({
  // ---- Agente ----
  AGENT_CREATED: "agent.created",
  AGENT_UPDATED: "agent.updated",
  AGENT_DELETED: "agent.deleted",
  AGENT_STARTED: "agent.started",
  AGENT_IDLE: "agent.idle",
  AGENT_WORKING: "agent.working",
  AGENT_BLOCKED: "agent.blocked",
  AGENT_ERROR: "agent.error",
  AGENT_DEPARTMENT_CHANGED: "agent.department.changed",

  // ---- Mensagens / comunicação entre agentes ----
  AGENT_MESSAGE_SENT: "agent.message.sent",
  AGENT_MESSAGE_RECEIVED: "agent.message.received",
  AGENT_MENTIONED: "agent.mentioned",

  // ---- Tarefas ----
  AGENT_TASK_CREATED: "agent.task.created",
  AGENT_TASK_ASSIGNED: "agent.task.assigned",
  AGENT_TASK_STARTED: "agent.task.started",
  AGENT_TASK_UPDATED: "agent.task.updated",
  AGENT_TASK_COMPLETED: "agent.task.completed",
  AGENT_TASK_FAILED: "agent.task.failed",
  AGENT_TASK_BLOCKED: "agent.task.blocked",

  // ---- Reuniões ----
  AGENT_MEETING_STARTED: "agent.meeting.started",
  AGENT_MEETING_ENDED: "agent.meeting.ended",

  // ---- Departamentos ----
  DEPARTMENT_CREATED: "department.created",
  DEPARTMENT_UPDATED: "department.updated",
  DEPARTMENT_DELETED: "department.deleted",

  // ---- Projetos ----
  PROJECT_CREATED: "project.created",
  PROJECT_UPDATED: "project.updated",
  PROJECT_COMPLETED: "project.completed",

  // ---- Runtimes (CLIs e IA local) ----
  RUNTIME_DETECTED: "runtime.detected",
  RUNTIME_STARTED: "runtime.started",
  RUNTIME_STOPPED: "runtime.stopped",
  RUNTIME_ERROR: "runtime.error",

  // ---- Permissões / aprovações sensíveis (seção 35) ----
  PERMISSION_REQUESTED: "permission.requested",
  PERMISSION_APPROVED: "permission.approved",
  PERMISSION_DENIED: "permission.denied",

  // ---- Sistema ----
  COMPANY_STATE_SYNCED: "company.state.synced",
  DATABASE_READY: "database.ready",
  SYSTEM_ERROR: "system.error",
});

/** Set com todos os valores válidos, pra validação O(1). */
const VALID_EVENT_VALUES = new Set(Object.values(EVENT_TYPES));

/**
 * Confere se uma string é um tipo de evento conhecido.
 * @param {string} type
 * @returns {boolean}
 */
function isValidEventType(type) {
  return VALID_EVENT_VALUES.has(type);
}

module.exports = {
  EVENT_TYPES,
  isValidEventType,
};