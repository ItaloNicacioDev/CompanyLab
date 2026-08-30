/**
 * defaultConversation.js
 *
 * `messages.conversation_id` não tem FOREIGN KEY pra `conversations` no
 * schema atual, mas é boa prática a conversa existir antes de guardar
 * mensagens nela (facilita listar conversas depois). Cria sob demanda,
 * idempotente.
 */

const { run, get } = require("./db");

/**
 * @param {string} conversationId
 * @param {string} [type='channel'] - 'channel' (chat geral) | 'direct' (1:1 entre agentes)
 * @returns {Promise<string>} o próprio conversationId
 */
async function ensureConversation(conversationId, type = "channel") {
  const existing = await get("SELECT id FROM conversations WHERE id = ?", [conversationId]);
  if (existing) return existing.id;

  await run("INSERT INTO conversations (id, type, participants) VALUES (?, ?, ?)", [
    conversationId,
    type,
    JSON.stringify([]),
  ]);
  return conversationId;
}

module.exports = { ensureConversation };