/**
 * AgentMemory.js
 * 
 * Responsável por gerenciar a memória de curto e longo prazo de um agente.
 * Interage diretamente com o banco de dados para salvar e recuperar o histórico.
 */

const db = require('../../../backend/database/db');

class AgentMemory {
  constructor(agentId) {
    this.agentId = agentId;
    this.systemPrompt = '';
  }

  /**
   * Define o system prompt (a "alma" do agente) que dá o contexto inicial.
   */
  async setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  getSystemPrompt() {
    return this.systemPrompt;
  }

  /**
   * Grava uma mensagem na memória (banco de dados)
   * @param {string} role 'user' ou 'assistant' ou 'system'
   * @param {string} content Conteúdo da mensagem
   */
  async addMessage(role, content) {
    const timestamp = Date.now();
    try {
      // Considerando que a tabela de mensagens chat tem esta estrutura (conforme o escopo)
      const sql = `
        INSERT INTO chat_messages (agent_id, role, content, timestamp)
        VALUES (?, ?, ?, ?)
      `;
      await db.run(sql, [this.agentId, role, content, timestamp]);
    } catch (error) {
      // Fallback gracioso se a tabela não existir, apenas avisa no console
      console.warn(`[AgentMemory] Erro ao gravar mensagem no DB para agente ${this.agentId}: ${error.message}`);
    }
  }

  /**
   * Recupera o contexto recente para enviar ao LLM.
   * @param {number} limit Quantidade de mensagens recentes
   */
  async getRecentContext(limit = 10) {
    try {
      const sql = `
        SELECT role, content, timestamp 
        FROM chat_messages 
        WHERE agent_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `;
      const rows = await db.all(sql, [this.agentId, limit]);
      
      // O banco retorna as mais recentes primeiro (DESC), precisamos reverter
      // para a ordem cronológica antes de mandar para o LLM.
      return rows.reverse();
    } catch (error) {
      console.warn(`[AgentMemory] Erro ao recuperar histórico para agente ${this.agentId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Constrói o array completo de mensagens formatado para o Runtime do LLM
   */
  async getFullPromptContext() {
    const history = await this.getRecentContext(15); // Pega as últimas 15 interações
    
    const context = [
      { role: 'system', content: this.systemPrompt }
    ];

    for (const msg of history) {
      context.push({
        role: msg.role,
        content: msg.content
      });
    }

    return context;
  }
}

module.exports = AgentMemory;
