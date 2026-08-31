/**
 * Orchestrator.js
 * 
 * Ouve os eventos de chat da empresa e acorda os agentes mencionados 
 * para processar e responder. O cérebro que interliga o UI -> Chat -> Agents.
 */

const EventBus = require('../events/EventBus');
const { EVENT_TYPES } = require('../events/eventTypes');
const AgentManager = require('../../agents/AgentManager');

class Orchestrator {
  init() {
    console.log('[Orchestrator] Inicializando ouvintes de eventos da empresa...');
    
    // Ouve todas as mensagens enviadas no chat
    EventBus.onEvent(EVENT_TYPES.AGENT_MESSAGE_SENT, async (event) => {
      const { from, content, mentions } = event.payload;

      // Se a mensagem não menciona ninguém explicitamente e não foi mandada 
      // diretamente pra ninguém, não fazemos nada.
      if (!mentions || mentions.length === 0) return;

      const agents = AgentManager.getAllAgents();
      
      for (const mentionName of mentions) {
        // Busca o agente pelo nome ignorando case
        const targetAgent = agents.find(a => a.name.toLowerCase() === mentionName.toLowerCase());
        
        if (targetAgent) {
          try {
            // Se quem enviou for "user", usaremos o label 'Usuário', senao buscamos o nome do remetente
            let fromName = 'Usuário';
            if (from !== 'user') {
              const sender = AgentManager.getAgent(from);
              if (sender) fromName = sender.name;
            }

            console.log(`[Orchestrator] Roteando mensagem de ${fromName} para ${targetAgent.name}...`);
            
            // Manda o AgentManager processar. O próprio manager já cuida
            // de emitir o novo evento de CHAT_MESSAGE com a resposta, 
            // e atualizar o status pra working/idle.
            await AgentManager.sendMessageToAgent(targetAgent.id, content, fromName);
            
          } catch (error) {
            console.error(`[Orchestrator] Erro ao rotear para ${targetAgent.name}:`, error);
          }
        }
      }
    });
  }
}

module.exports = new Orchestrator();
