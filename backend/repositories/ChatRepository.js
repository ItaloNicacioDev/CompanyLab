/**
 * ChatRepository.js
 * 
 * Abstrai as queries da tabela 'chat_messages'.
 */

const db = require('../database/db');

class ChatRepository {
  async saveMessage(agentId, role, content) {
    const timestamp = Date.now();
    const sql = `
      INSERT INTO chat_messages (agent_id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `;
    return db.run(sql, [agentId, role, content, timestamp]);
  }

  async getRecentContext(agentId, limit = 10) {
    const sql = `
      SELECT role, content, timestamp 
      FROM chat_messages 
      WHERE agent_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `;
    return db.all(sql, [agentId, limit]);
  }
}

module.exports = new ChatRepository();
