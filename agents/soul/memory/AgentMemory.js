/**
 * AgentMemory.js
 * 
 * Responsável por gerenciar a memória de curto e longo prazo de um agente.
 * Agora utiliza o ChatRepository seguindo o padrão de arquitetura (Repository Pattern).
 */

const ChatRepository = require('../../../backend/repositories/ChatRepository');

class AgentMemory {
  constructor(agentId) {
    this.agentId = agentId;
    this.systemPrompt = '';
  }

  async setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  getSystemPrompt() {
    return this.systemPrompt;
  }

  async addMessage(role, content) {
    try {
      await ChatRepository.saveMessage(this.agentId, role, content);
    } catch (error) {
      console.warn(`[AgentMemory] Erro ao gravar mensagem no DB para agente ${this.agentId}: ${error.message}`);
    }
  }

  async getRecentContext(limit = 10) {
    try {
      const rows = await ChatRepository.getRecentContext(this.agentId, limit);
      // O banco retorna as mais recentes primeiro (DESC), revertemos para ordem cronológica
      return rows.reverse();
    } catch (error) {
      console.warn(`[AgentMemory] Erro ao recuperar histórico para agente ${this.agentId}: ${error.message}`);
      return [];
    }
  }

  async getFullPromptContext() {
    const history = await this.getRecentContext(15);
    
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
