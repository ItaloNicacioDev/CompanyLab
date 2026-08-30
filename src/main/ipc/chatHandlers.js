/**
 * chatHandlers.js
 *
 * Handlers IPC do chat compartilhado da empresa (seção 8 do spec).
 * chat:getMessages e chat:sendMessage já são chamados pelo renderer.js
 * atual.
 *
 * IMPORTANTE (seção 38 — No Fake Multi-Agent System): este handler só
 * PERSISTE a mensagem e emite o evento — ele NÃO finge que um agente
 * respondeu. O roteamento real de @menções pra sessões de runtime dos
 * agentes mencionados é responsabilidade do core/orchestrator/, que
 * ainda não foi construído. Até lá, mandar uma mensagem com "@Legoshi"
 * salva a menção (pro histórico e pra UI destacar), mas nenhuma
 * resposta automática é gerada.
 */

const { run, all } = require("../../../backend/database/db");
const { generateId } = require("../../../backend/utils/id");
const { ensureConversation } = require("../../../backend/database/defaultConversation");
const EventBus = require("../../../core/events/EventBus");
const { EVENT_TYPES } = require("../../../core/events/eventTypes");

const DEFAULT_CONVERSATION_ID = "company-general";
const USER_SENTINEL = "user";

function safeParseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapMessageRow(row) {
  const isUser = row.from_agent === USER_SENTINEL || !row.from_agent;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    isUser,
    sender: isUser ? "Você" : row.from_name || "Agente",
    avatar: row.from_avatar || null,
    from: row.from_agent,
    to: row.to_agent,
    content: row.content,
    mentions: safeParseJSON(row.mentions, []),
    type: row.type,
    timestamp: row.created_at,
  };
}

/** Extrai @menções de agentes do texto — usado depois pelo Orchestrator pra rotear. */
function extractMentions(content) {
  const matches = content.match(/@([\p{L}0-9_]+)/gu) || [];
  return matches.map((m) => m.slice(1));
}

/** @param {import('electron').IpcMain} ipcMain */
function registerChatHandlers(ipcMain) {
  ipcMain.handle("chat:getMessages", async (_event, conversationId = DEFAULT_CONVERSATION_ID) => {
    await ensureConversation(conversationId);
    const rows = await all(
      `SELECT m.*, a.name as from_name, a.avatar as from_avatar
       FROM messages m LEFT JOIN agents a ON m.from_agent = a.id
       WHERE m.conversation_id = ? ORDER BY m.created_at ASC`,
      [conversationId]
    );
    return rows.map(mapMessageRow);
  });

  ipcMain.handle("chat:sendMessage", async (_event, payload = {}) => {
    const {
      content,
      conversationId = DEFAULT_CONVERSATION_ID,
      fromAgent = USER_SENTINEL,
      toAgent = null,
    } = payload;

    if (!content || !content.trim()) {
      return { success: false, error: "Mensagem vazia." };
    }

    await ensureConversation(conversationId);
    const id = generateId("msg");
    const mentions = extractMentions(content);

    await run(
      `INSERT INTO messages (id, conversation_id, from_agent, to_agent, content, mentions, type) VALUES (?, ?, ?, ?, ?, ?, 'text')`,
      [id, conversationId, fromAgent, toAgent, content, JSON.stringify(mentions)]
    );

    // Alimenta o feed de atividade do dashboard (dashboardHandlers.js lê daqui).
    await run("INSERT INTO activity_log (agent_id, action, metadata) VALUES (?, 'message', ?)", [
      fromAgent === USER_SENTINEL ? null : fromAgent,
      JSON.stringify({ fromName: fromAgent === USER_SENTINEL ? "Você" : fromAgent, from: fromAgent, content }),
    ]);

    EventBus.emitEvent(EVENT_TYPES.AGENT_MESSAGE_SENT, {
      messageId: id,
      from: fromAgent,
      to: toAgent,
      content,
      mentions,
    });

    return { success: true, messageId: id, mentions };
  });
}

module.exports = registerChatHandlers;