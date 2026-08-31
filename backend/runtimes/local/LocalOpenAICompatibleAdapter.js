/**
 * LocalOpenAICompatibleAdapter.js
 *
 * Adapter genérico pra QUALQUER servidor de IA local que fale o
 * protocolo de chat da OpenAI (/v1/chat/completions, /v1/models) —
 * cobre Ollama, LM Studio, llama.cpp e qualquer "Local (Custom)" que
 * o usuário aponte manualmente (seção 16/17 do spec).
 *
 * Diferente dos adapters de CLI, este NÃO sobe nenhum processo — o
 * servidor local (Ollama etc.) já é responsabilidade do próprio
 * usuário manter rodando como um serviço; o adapter só fala HTTP com
 * ele. Isso é consistente com como esses runtimes funcionam na
 * prática (serviços de longa duração, não CLIs de tiro único).
 */

const crypto = require("crypto");
const { RuntimeAdapter, buildSystemPromptFromAgentConfig } = require("../RuntimeAdapter");

const AVAILABILITY_TIMEOUT_MS = 5000;

class LocalOpenAICompatibleAdapter extends RuntimeAdapter {
  /**
   * @param {object} options
   * @param {string} options.baseUrl - ex: 'http://localhost:11434'
   * @param {string} [options.model] - modelo padrão, se a sessão não especificar outro
   * @param {string} [options.chatEndpoint='/v1/chat/completions']
   * @param {string} [options.modelsEndpoint='/v1/models']
   * @param {string} [options.displayName]
   */
  constructor({ baseUrl, model = null, chatEndpoint = "/v1/chat/completions", modelsEndpoint = "/v1/models", displayName } = {}) {
    super(displayName || "Local (OpenAI-compatible)");
    if (!baseUrl) {
      throw new Error(`[${displayName || "LocalOpenAICompatibleAdapter"}] baseUrl é obrigatório.`);
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.chatEndpoint = chatEndpoint;
    this.modelsEndpoint = modelsEndpoint;

    /** @type {Map<string, {messages: {role:string, content:string}[], model: string|null}>} */
    this._sessions = new Map();
  }

  async isAvailable() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);
      const res = await fetch(this.baseUrl + this.modelsEndpoint, { signal: controller.signal });
      clearTimeout(timeoutId);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Lista os modelos carregados no servidor local agora — usado pela
   * tela de criação de agente pra popular o dropdown de modelo (só
   * mostra o que está realmente disponível, sem o usuário digitar
   * nome errado).
   * @returns {Promise<string[]>}
   */
  async listModels() {
    const res = await fetch(this.baseUrl + this.modelsEndpoint);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data || []).map((m) => m.id).filter(Boolean);
  }

  /** @param {object} agentConfig @returns {Promise<string>} */
  async createSession(agentConfig = {}) {
    const sessionId = crypto.randomUUID();
    const messages = [];
    const systemPrompt = buildSystemPromptFromAgentConfig(agentConfig);
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

    this._sessions.set(sessionId, {
      messages,
      model: agentConfig.model || this.model,
    });

    return sessionId;
  }

  /** @param {string} sessionId @param {string} message @returns {Promise<string>} */
  async sendMessage(sessionId, message) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`[${this.name}] Sessão "${sessionId}" não existe (createSession não foi chamado?).`);
    }
    if (!session.model) {
      throw new Error(
        `[${this.name}] Nenhum modelo definido pra essa sessão. Configure um modelo pro agente ` +
          `(use listModels() na UI de criação pra listar os disponíveis).`
      );
    }

    session.messages.push({ role: "user", content: message });

    const res = await fetch(this.baseUrl + this.chatEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: session.model, messages: session.messages }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`[${this.name}] Erro HTTP ${res.status} ao enviar mensagem. ${errBody}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content || "";
    session.messages.push({ role: "assistant", content: reply });

    return reply;
  }

  async endSession(sessionId) {
    this._sessions.delete(sessionId);
  }
}

module.exports = { LocalOpenAICompatibleAdapter };