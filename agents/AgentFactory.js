/**
 * AgentFactory.js
 * 
 * Responsável por instanciar os objetos Agent com base nos dados que
 * vêm do banco de dados e acoplar a memória correspondente.
 */

const AgentMemory = require('./soul/memory/AgentMemory');
const runtimeSessionManager = require('../backend/runtimes/runtimeSessionManager');

class Agent {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.role = data.role;
    this.department = data.department || 'Geral';
    this.runtime = data.runtime || 'opencode';
    this.model = data.model || null;
    this.status = data.status || 'idle';
    
    // Configurações avançadas
    this.personality = data.personality || {};
    this.skills = data.skills || [];
    this.isCEO = data.isCEO ?? data.isCeo ?? false;
    
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

    // 2. Chama de verdade o runtime configurado pro agente (OpenCode,
    // Codex, Claude Code, Ollama, LM Studio — ver backend/runtimes/).
    // O adapter já mantém o histórico do lado dele (sessão real), então
    // não precisamos reinjetar o contexto da AgentMemory aqui.
    const response = await runtimeSessionManager.sendMessage(this, `[${fromName}]: ${content}`);

    // 3. Grava a resposta do próprio agente na memória
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