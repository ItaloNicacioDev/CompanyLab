/**
 * AgentFactory.js
 * 
 * Responsável por instanciar os objetos Agent com base nos dados que
 * vêm do banco de dados e acoplar a memória correspondente.
 */

const AgentMemory = require('./soul/memory/AgentMemory');

class Agent {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.role = data.role;
    this.department = data.department || 'Geral';
    this.runtime = data.runtime || 'opencode';
    this.status = data.status || 'idle';
    
    // Configurações avançadas
    this.personality = data.personality || {};
    this.skills = data.skills || [];
    this.isCEO = data.isCEO || false;
    
    // Injeta a dependência de memória (Soul)
    this.memory = new AgentMemory(this.id);
  }

  /**
   * Chamado logo após a instanciação para carregar dependências assíncronas.
   */
  async initialize() {
    const personalityDesc = this.personality.description || 'Profissional e prestativo.';
    const skillsList = this.skills.length > 0 ? this.skills.join(', ') : 'Nenhuma específica.';
    
    // Monta o System Prompt base da "alma" desse agente
    const systemPrompt = `Você é ${this.name}, atuando como ${this.role} no departamento de ${this.department} da empresa.
Sua personalidade: ${personalityDesc}.
Suas habilidades/ferramentas: ${skillsList}.
Aja de forma coerente com sua persona e contexto.`;
    
    await this.memory.setSystemPrompt(systemPrompt);
  }

  /**
   * Processa uma nova mensagem recebida (chamado pelo AgentManager).
   */
  async processMessage(content, fromName = 'Usuário') {
    // 1. Grava a mensagem recebida na memória
    await this.memory.addMessage('user', `[${fromName}]: ${content}`);
    
    // 2. Recupera todo o contexto (system prompt + histórico recente)
    const context = await this.memory.getFullPromptContext();
    
    // 3. TODO: Aqui ocorre a chamada real para o Runtime (Ollama, OpenAI, LM Studio, etc)
    // Simulando delay de LLM (Remover quando houver integração real com LLM Runtime)
    await new Promise(resolve => setTimeout(resolve, 1500));
    const response = `Compreendido, ${fromName}. Analisei sua mensagem "${content}" com base nas minhas skills. Em breve integraremos o Runtime de IA real.`;
    
    // 4. Grava a resposta do próprio agente na memória
    await this.memory.addMessage('assistant', response);
    
    return response;
  }
}

class AgentFactory {
  /**
   * Cria uma nova instância da classe Agent baseada nos dados puros do banco
   * @param {Object} agentData Dados brutos (row do SQLite)
   * @returns {Agent} Instância inicializada e pronta
   */
  static async createAgent(agentData) {
    // Trata parsing de JSON caso venham do SQLite como strings (muito comum)
    if (typeof agentData.personality === 'string') {
      try { agentData.personality = JSON.parse(agentData.personality); } 
      catch (e) { agentData.personality = {}; }
    }
    
    if (typeof agentData.skills === 'string') {
      try { agentData.skills = JSON.parse(agentData.skills); } 
      catch (e) { agentData.skills = []; }
    }

    const agent = new Agent(agentData);
    await agent.initialize(); // Carrega o prompt e configurações de memória
    
    return agent;
  }
}

module.exports = AgentFactory;
