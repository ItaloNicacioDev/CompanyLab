/**
 * AgentManager.js
 * 
 * Gerencia o ciclo de vida dos agentes (Singleton). 
 * Mantém todos os agentes ativos em memória, orquestra o envio de mensagens 
 * e emite eventos globais (EventBus) para a UI refletir os status (idle, working).
 */

const db = require('../backend/database/db');
const AgentFactory = require('./AgentFactory');
const EventBus = require('../core/events/EventBus');
const { EVENT_TYPES } = require('../core/events/eventTypes');

class AgentManager {
  constructor() {
    this.agents = new Map();
  }

  /**
   * Inicia o manager: lê todos os agentes do DB e cria as instâncias na memória RAM.
   * Deve ser chamado durante o boot do processo principal (main.js).
   */
  async init() {
    try {
      const sql = `SELECT * FROM agents`;
      const agentsData = await db.all(sql);
      
      for (const data of agentsData) {
        const agent = await AgentFactory.createAgent(data);
        this.agents.set(agent.id, agent);
      }
      console.log(`[AgentManager] Inicializado com ${this.agents.size} agentes ativos.`);
    } catch (error) {
      console.warn(`[AgentManager] Erro ao carregar agentes (tabela possivelmente vazia/inexistente):`, error.message);
    }
  }

  /**
   * Retorna a instância de um agente específico
   */
  getAgent(id) {
    return this.agents.get(id);
  }

  /**
   * Retorna array com todos os agentes em memória
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Registra um novo agente criado (ex: recebido da UI via IPC handler)
   */
  async registerAgent(agentData) {
    const agent = await AgentFactory.createAgent(agentData);
    this.agents.set(agent.id, agent);
    
    // Notifica todo o sistema que um novo agente entrou
    EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId: agent.id });
    
    return agent;
  }

  /**
   * Remove um agente da memória (quando deletado)
   */
  unregisterAgent(id) {
    if (this.agents.has(id)) {
      this.agents.delete(id);
      EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId: id, deleted: true });
    }
  }

  /**
   * Envia uma mensagem para o agente e cuida de todo o workflow de status
   * @param {number|string} agentId ID do agente de destino
   * @param {string} messageContent Conteúdo da mensagem
   * @param {string} fromName Quem enviou (ex: 'Usuário' ou nome de outro agente)
   */
  async sendMessageToAgent(agentId, messageContent, fromName = 'Usuário') {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      throw new Error(`Agente com ID ${agentId} não está rodando/não existe na memória.`);
    }

    // 1. Muda status do agente pra 'working' e avisa o EventBus
    // (Isso faz a UI no Electron atualizar a bolinha do agente pra verde)
    agent.status = 'working';
    EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'working' });

    try {
      // 2. Faz o agente pensar e responder (via AgentFactory / Memory)
      const response = await agent.processMessage(messageContent, fromName);

      // 3. Volta pra 'idle'
      agent.status = 'idle';
      EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'idle' });

      // Emite evento de que o agente gerou uma mensagem (pra o chat renderizar e o dashboard exibir)
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
      
      // 4. Status de Erro (bolinha vermelha)
      agent.status = 'error';
      EventBus.emit(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'error' });
      throw error;
    }
  }
}

// Exporta como Singleton, pois deve existir apenas 1 Source of Truth de agentes na RAM.
const instance = new AgentManager();
module.exports = instance;
