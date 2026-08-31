/**
 * AgentManager.js
 * 
 * Gerencia o ciclo de vida dos agentes (Singleton). 
 * Utiliza o AgentRepository para operações de banco de dados, seguindo o Repository Pattern.
 */

const AgentRepository = require('../backend/repositories/AgentRepository');
const AgentFactory = require('./AgentFactory');
const EventBus = require('../core/events/EventBus');
const { EVENT_TYPES } = require('../core/events/eventTypes');

class AgentManager {
  constructor() {
    this.agents = new Map();
  }

  /**
   * Inicia o manager carregando os dados através do Repositório.
   */
  async init() {
    try {
      const agentsData = await AgentRepository.getAllAgents();
      
      for (const data of agentsData) {
        const agent = await AgentFactory.createAgent(data);
        this.agents.set(agent.id, agent);
      }
      console.log(`[AgentManager] Inicializado com ${this.agents.size} agentes ativos.`);
    } catch (error) {
      console.warn(`[AgentManager] Erro ao carregar agentes (tabela possivelmente vazia/inexistente):`, error.message);
    }
  }

  getAgent(id) {
    return this.agents.get(id);
  }

  getAllAgents() {
    return Array.from(this.agents.values());
  }

  async registerAgent(agentData) {
    const agent = await AgentFactory.createAgent(agentData);
    this.agents.set(agent.id, agent);
    EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId: agent.id });
    return agent;
  }

  unregisterAgent(id) {
    if (this.agents.has(id)) {
      this.agents.delete(id);
      EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId: id, deleted: true });
    }
  }

  async sendMessageToAgent(agentId, messageContent, fromName = 'Usuário') {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      throw new Error(`Agente com ID ${agentId} não está rodando/não existe na memória.`);
    }

    agent.status = 'working';
    await AgentRepository.updateAgentStatus(agentId, 'working'); // Mantém o status real no DB
    EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'working' });

    try {
      const response = await agent.processMessage(messageContent, fromName);

      agent.status = 'idle';
      await AgentRepository.updateAgentStatus(agentId, 'idle');
      EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'idle' });

      EventBus.emit(EVENT_TYPES.CHAT_MESSAGE, {
        channel: 'company-general',
        from: agent.id,
        fromName: agent.name,
        content: response,
        timestamp: Date.now()
      });

      return response;
    } catch (error) {
      console.error(`[AgentManager] Agente ${agentId} travou no processamento:`, error);
      
      agent.status = 'error';
      await AgentRepository.updateAgentStatus(agentId, 'error');
      EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'error' });
      throw error;
    }
  }
}

const instance = new AgentManager();
module.exports = instance;
