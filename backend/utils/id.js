/**
 * id.js
 *
 * Gerador de IDs únicos compartilhado por todos os handlers/repositórios.
 * Usa `crypto.randomUUID()` (nativo do Node desde a v14.17 — sem precisar
 * instalar o pacote `uuid`).
 */

const crypto = require("crypto");

/**
 * @param {string} [prefix] - ex: 'agent', 'dept', 'task' -> "agent_3f9a..."
 * @returns {string}
 */
function generateId(prefix) {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

module.exports = { generateId };