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
const { run } = require('../backend/database/db');
const { generateId } = require('../backend/utils/id.js');
const { extractMentions, DEFAULT_CONVERSATION_ID } = require('../src/main/ipc/chatHandlers');

// Status que só fazem sentido enquanto existe um processo de verdade
// rodando. Como cada mensagem é uma chamada de CLI isolada (sem
// processo de vida longa por agente), nada disso pode legitimamente
// sobreviver a um restart do app — se um agente carrega um desses do
// banco no boot, é lixo de uma sessão anterior que foi fechada no meio
// de uma resposta (ou travou), não atividade real acontecendo agora.
const STALE_STATUSES_ON_BOOT = new Set(['working', 'communicating', 'meeting', 'error']);

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
        // Limpa estado fantasma de uma sessão anterior interrompida
        // (ver STALE_STATUSES_ON_BOOT acima) — sem isso, um agente que
        // estava "working" quando o app foi fechado nascia preso em
        // erro/working pra sempre, mesmo sem nada de fato rodando.
        if (STALE_STATUSES_ON_BOOT.has(data.status)) {
          data.status = 'idle';
          await AgentRepository.updateAgentStatus(data.id, 'idle').catch(() => {});
        }
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
    EventBus.emitEvent(EVENT_TYPES.AGENT_UPDATED, { agentId: agent.id });
    return agent;
  }

  unregisterAgent(id) {
    if (this.agents.has(id)) {
      this.agents.delete(id);
      EventBus.emitEvent(EVENT_TYPES.AGENT_UPDATED, { agentId: id, deleted: true });
    }
  }

  async sendMessageToAgent(agentId, messageContent, fromName = 'Usuário') {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      throw new Error(`Agente com ID ${agentId} não está rodando/não existe na memória.`);
    }

    agent.status = 'working';
    await AgentRepository.updateAgentStatus(agentId, 'working'); // Mantém o status real no DB
    EventBus.emitEvent(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'working' });

    try {
      const response = await agent.processMessage(messageContent, fromName);

      agent.status = 'idle';
      await AgentRepository.updateAgentStatus(agentId, 'idle');
      EventBus.emitEvent(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'idle' });

      // BUGFIX: a resposta do agente precisa ser PERSISTIDA na mesma tabela
      // 'messages' que o chatHandlers.js usa, senão chat:getMessages nunca
      // a retorna pro renderer (era o motivo do @agente nunca "responder").
      const messageId = generateId('msg');
      const mentions = extractMentions(response);

      await run(
        `INSERT INTO messages (id, conversation_id, from_agent, to_agent, content, mentions, type) VALUES (?, ?, ?, ?, ?, ?, 'text')`,
        [messageId, DEFAULT_CONVERSATION_ID, agent.id, null, response, JSON.stringify(mentions)]
      );

      await run("INSERT INTO activity_log (agent_id, action, metadata) VALUES (?, 'message', ?)", [
        agent.id,
        JSON.stringify({ fromName: agent.name, from: agent.id, content: response }),
      ]);

      // BUGFIX: EVENT_TYPES.CHAT_MESSAGE não existia (era `undefined`) e o
      // .emit() cru nunca passava pelo canal "event" que main.js retransmite
      // ao renderer. Reaproveitamos AGENT_MESSAGE_SENT (já existe, já é
      // válido, e já é escutado pelo Orchestrator — então se o agente
      // mencionar outro agente na resposta, o roteamento encadeia normalmente).
      EventBus.emitEvent(EVENT_TYPES.AGENT_MESSAGE_SENT, {
        messageId,
        from: agent.id,
        to: null,
        content: response,
        mentions,
      });

      return response;
    } catch (error) {
      console.error(`[AgentManager] Agente ${agentId} travou no processamento:`, error);

      agent.status = 'error';
      await AgentRepository.updateAgentStatus(agentId, 'error');
      EventBus.emitEvent(EVENT_TYPES.AGENT_UPDATED, { agentId, status: 'error' });

      // Sem isso, uma falha de runtime (CLI não instalada, servidor local
      // fora do ar, etc.) travava o agente em silêncio: nenhum erro, nenhuma
      // mensagem — exatamente o sintoma original. Agora a falha vira uma
      // mensagem 'error' visível no próprio chat, pro usuário saber o que houve.
      try {
        const errorMessageId = generateId('msg');
        const errorContent = `⚠️ ${agent.name} não conseguiu responder: ${error.message}`;

        await run(
          `INSERT INTO messages (id, conversation_id, from_agent, to_agent, content, mentions, type) VALUES (?, ?, ?, ?, ?, ?, 'error')`,
          [errorMessageId, DEFAULT_CONVERSATION_ID, agent.id, null, errorContent, '[]']
        );

        EventBus.emitEvent(EVENT_TYPES.AGENT_MESSAGE_SENT, {
          messageId: errorMessageId,
          from: agent.id,
          to: null,
          content: errorContent,
          mentions: [],
        });
      } catch (persistError) {
        console.error(`[AgentManager] Falha ao persistir mensagem de erro do agente ${agentId}:`, persistError);
      }

      throw error;
    }
  }
}

const instance = new AgentManager();
module.exports = instance;