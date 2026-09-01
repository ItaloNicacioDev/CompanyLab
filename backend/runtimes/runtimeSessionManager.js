/**
 * runtimeSessionManager.js
 *
 * Ponte que faltava entre agents/AgentFactory.js (o "corpo" do agente)
 * e backend/runtimes/* (os adapters que sabem falar HTTP/CLI com
 * OpenCode, Codex, Claude Code, Ollama, LM Studio, etc).
 *
 * Responsabilidades:
 *  1. Traduzir o slug salvo em agent.runtime (ex: "claude-code", vindo
 *     do <select id="agent-runtime"> da UI) pra chave de
 *     config/default.json (ex: "Claude Code"), que é o que
 *     runtimeDetector.createAdapterForRuntime() espera.
 *  2. Cachear UMA instância de adapter por runtime configurado (os
 *     adapters de CLI sobem um processo de servidor compartilhado —
 *     não faz sentido subir um "opencode serve" por agente).
 *  3. Cachear UMA sessão (sessionId) por agente — criada de forma
 *     preguiçosa (lazy) na primeira mensagem, reaproveitada depois.
 */

const defaultConfig = require("../../config/default.json");
const { createAdapterForRuntime } = require("./runtimeDetector");

/** Slug salvo no banco (agent.runtime) -> chave usada em config/default.json (runtimes.*) */
const RUNTIME_SLUG_TO_CONFIG_KEY = Object.freeze({
  opencode: "OpenCode",
  codex: "Codex",
  "claude-code": "Claude Code",
  ollama: "Local (Ollama)",
  lmstudio: "Local (LM Studio)",
  llamacpp: "Local (llama.cpp)",
  custom: "Local (Custom)",
});

class RuntimeSessionManager {
  constructor() {
    /** @type {Map<string, import('./RuntimeAdapter').RuntimeAdapter>} chave: nome do runtime em config/default.json */
    this._adapters = new Map();
    /** @type {Map<string, {adapterKey: string, sessionId: string}>} chave: agent.id */
    this._sessions = new Map();
  }

  /** @param {string} runtimeSlug - agent.runtime (ex: 'opencode') */
  _resolveConfigKey(runtimeSlug) {
    const configKey = RUNTIME_SLUG_TO_CONFIG_KEY[runtimeSlug];
    if (!configKey || !defaultConfig.runtimes?.[configKey]) {
      throw new Error(
        `[RuntimeSessionManager] Runtime "${runtimeSlug}" não está mapeado/configurado. ` +
          `Verifique agent.runtime e config/default.json.`
      );
    }
    return configKey;
  }

  /** @param {string} configKey - chave em config/default.json (ex: "OpenCode") */
  _getOrCreateAdapter(configKey) {
    if (this._adapters.has(configKey)) return this._adapters.get(configKey);

    const adapter = createAdapterForRuntime(configKey, defaultConfig.runtimes[configKey]);
    this._adapters.set(configKey, adapter);
    return adapter;
  }

  /**
   * Garante que o runtime configurado pro agente está de pé e devolve
   * o adapter + sessionId prontos pra uso.
   * @param {object} agent - instância de Agent (AgentFactory.js)
   */
  async _ensureSession(agent) {
    const configKey = this._resolveConfigKey(agent.runtime);
    const adapter = this._getOrCreateAdapter(configKey);

    const cached = this._sessions.get(agent.id);
    if (cached && cached.adapterKey === configKey) {
      return { adapter, sessionId: cached.sessionId };
    }

    const available = await adapter.isAvailable();
    if (!available) {
      throw new Error(
        `[RuntimeSessionManager] Runtime "${configKey}" não está disponível agora. ` +
          `Confira se está instalado/rodando (aba Runtimes do CompanyLab).`
      );
    }

    const sessionId = await adapter.createSession({
      name: agent.name,
      role: agent.role,
      personality: agent.personality,
      responsibilities: agent.skills,
      model: agent.model,
    });

    this._sessions.set(agent.id, { adapterKey: configKey, sessionId });
    return { adapter, sessionId };
  }

  /**
   * Manda uma mensagem pro runtime real do agente e devolve a resposta.
   * @param {object} agent
   * @param {string} message
   * @returns {Promise<string>}
   */
  async sendMessage(agent, message) {
    if (!agent.runtime) {
      throw new Error(
        `[RuntimeSessionManager] O agente "${agent.name}" não tem um runtime configurado. ` +
          `Edite o agente e escolha um runtime (OpenCode, Codex, Claude Code, Ollama, LM Studio).`
      );
    }

    const { adapter, sessionId } = await this._ensureSession(agent);

    try {
      return await adapter.sendMessage(sessionId, message);
    } catch (error) {
      // Sessão pode ter caído (processo de CLI morreu, servidor local
      // reiniciou etc.) — invalida o cache pra próxima tentativa criar
      // uma sessão nova, em vez de ficar presa num sessionId morto.
      this._sessions.delete(agent.id);
      throw error;
    }
  }

  /** Encerra e limpa a sessão de um agente específico (ex: ao deletar o agente). */
  async endSession(agentId) {
    const cached = this._sessions.get(agentId);
    if (!cached) return;
    const adapter = this._adapters.get(cached.adapterKey);
    if (adapter) {
      try {
        await adapter.endSession(cached.sessionId);
      } catch {
        // best-effort — não trava o fluxo de deleção do agente por causa disso
      }
    }
    this._sessions.delete(agentId);
  }

  /** Libera todos os processos/conexões de runtime. Chamado no shutdown do app. */
  async disposeAll() {
    for (const adapter of this._adapters.values()) {
      try {
        await adapter.dispose();
      } catch {
        // best-effort
      }
    }
    this._adapters.clear();
    this._sessions.clear();
  }
}

module.exports = new RuntimeSessionManager();