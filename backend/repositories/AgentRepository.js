/**
 * AgentRepository.js
 * 
 * Abstrai todas as queries SQL relacionadas à tabela 'agents'.
 */

const db = require('../database/db');

class AgentRepository {
  async getAllAgents() {
    return db.all('SELECT * FROM agents');
  }

  async getAgentById(id) {
    return db.get('SELECT * FROM agents WHERE id = ?', [id]);
  }

  async createAgent(data) {
    const sql = `
      INSERT INTO agents (name, role, department, runtime, status, personality, skills, is_ceo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    // Normaliza para string JSON para salvar no SQLite
    const personality = typeof data.personality === 'object' ? JSON.stringify(data.personality) : data.personality;
    const skills = Array.isArray(data.skills) ? JSON.stringify(data.skills) : data.skills;
    const isCeo = data.isCEO ? 1 : 0;
    
    const result = await db.run(sql, [
      data.name,
      data.role,
      data.department || 'Geral',
      data.runtime || 'opencode',
      data.status || 'idle',
      personality,
      skills,
      isCeo
    ]);
    
    return this.getAgentById(result.lastID);
  }

  async updateAgentStatus(id, status) {
    return db.run('UPDATE agents SET status = ? WHERE id = ?', [status, id]);
  }

  async deleteAgent(id) {
    return db.run('DELETE FROM agents WHERE id = ?', [id]);
  }
}

module.exports = new AgentRepository();
