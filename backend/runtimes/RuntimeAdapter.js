/**
 * RuntimeAdapter.js
 *
 * Interface comum que TODO adapter de runtime (CLI ou servidor local)
 * implementa — é isso que permite ao Orchestrator (mais pra frente)
 * mandar mensagem pra um agente sem saber se por trás é OpenCode,
 * Codex, Claude Code, Ollama ou qualquer outro (seção 17 do spec:
 * AGENT -> RUNTIME/CLI -> MODEL/PROVIDER).
 *
 * REQUISITO CENTRAL: o usuário NUNCA deve precisar abrir um terminal
 * manualmente — tudo roda escondido, controlado pelo próprio app. Os
 * dois métodos `spawnHidden()`/`runHiddenAndCapture()` abaixo são o
 * único lugar onde processos de CLI são criados, e ambos usam
 * `windowsHide: true` + `stdio` capturado (nunca herdado) — é isso
 * que impede QUALQUER janela de console de aparecer no Windows.
 */

const { spawn } = require("child_process");

class RuntimeAdapter {
  /** @param {string} name - nome legível, usado em logs/erros (ex: "OpenCode") */
  constructor(name) {
    if (new.target === RuntimeAdapter) {
      throw new Error(
        "RuntimeAdapter é uma classe base — instancie uma subclasse (OpenCodeAdapter, ClaudeCodeAdapter, LocalOpenAICompatibleAdapter, etc.)."
      );
    }
    this.name = name;
  }

  /** @returns {Promise<boolean>} true se esse runtime está instalado/acessível agora */
  async isAvailable() {
    throw new Error(`${this.constructor.name}.isAvailable() não implementado.`);
  }

  /**
   * Abre uma sessão de conversa nova pra um agente específico.
   * @param {object} agentConfig - { name, role, personality, soul, responsibilities, model, ... }
   * @returns {Promise<string>} sessionId
   */
  async createSession(agentConfig) {
    throw new Error(`${this.constructor.name}.createSession() não implementado.`);
  }

  /**
   * @param {string} sessionId
   * @param {string} message
   * @returns {Promise<string>} resposta de texto do agente
   */
  async sendMessage(sessionId, message) {
    throw new Error(`${this.constructor.name}.sendMessage() não implementado.`);
  }

  /** @param {string} sessionId */
  async endSession(sessionId) {
    // no-op por padrão — nem todo adapter precisa encerrar sessão explicitamente
  }

  /** Libera qualquer processo/conexão em segundo plano. Chamado no shutdown do app. */
  async dispose() {
    // no-op por padrão
  }

  // =========================================================
  // Helpers compartilhados de execução ESCONDIDA de processo
  // =========================================================

  /**
   * Sobe um processo de CLI de VIDA LONGA (ex: um servidor), sem
   * janela de terminal visível. Usado por adapters que falam com um
   * servidor local do próprio CLI (ex: `opencode serve`).
   *
   * @param {string} command
   * @param {string[]} [args]
   * @param {object} [options] - opções extras pro child_process.spawn
   * @returns {import('child_process').ChildProcess}
   */
  spawnHidden(command, args = [], options = {}) {
    const child = spawn(command, args, {
      windowsHide: true, // <- impede a janela de console de aparecer no Windows
      stdio: ["ignore", "pipe", "pipe"], // stdin ignorado, stdout/stderr CAPTURADOS (nunca herdados)
      ...options,
    });

    child.stdout?.on("data", (chunk) => this._log(`[${this.name} stdout] ${chunk.toString().trim()}`));
    child.stderr?.on("data", (chunk) => this._log(`[${this.name} stderr] ${chunk.toString().trim()}`));

    return child;
  }

  /**
   * Roda um comando de CLI escondido do início ao fim (um "tiro só") e
   * devolve TODA a saída de stdout como string quando o processo
   * termina. Usado por adapters sem modo servidor persistente (cada
   * mensagem vira uma chamada isolada e completa).
   *
   * @param {string} command
   * @param {string[]} [args]
   * @param {object} [options]
   * @param {number} [options.timeoutMs=60000]
   * @returns {Promise<string>}
   */
  runHiddenAndCapture(command, args = [], { timeoutMs = 60000, ...spawnOptions } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        ...spawnOptions,
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`[${this.name}] Tempo esgotado (${timeoutMs}ms) esperando resposta de "${command}".`));
      }, timeoutMs);

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (err.code === "ENOENT") {
          reject(new Error(`[${this.name}] "${command}" não encontrado (CLI não está instalada ou não está no PATH).`));
        } else {
          reject(new Error(`[${this.name}] Falha ao executar "${command}": ${err.message}`));
        }
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`[${this.name}] "${command}" saiu com código ${code}. stderr: ${stderr.trim() || "(vazio)"}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

  _log(message) {
    // Centralizado aqui pra, no futuro, virar log de verdade (arquivo/
    // painel interno do app) em vez de console.log solto por adapter.
    console.log(message);
  }
}

/**
 * Monta um prompt de sistema a partir da config de um agente — usado
 * por TODO adapter na criação de sessão, pra fixar a identidade do
 * agente (seção 6 do spec: soul.md, personalidade, responsabilidades).
 * @param {object} agentConfig
 * @returns {string}
 */
function buildSystemPromptFromAgentConfig(agentConfig = {}) {
  const parts = [];
  if (agentConfig.role) parts.push(`Seu cargo é: ${agentConfig.role}.`);
  if (agentConfig.personality?.description) parts.push(`Sua personalidade: ${agentConfig.personality.description}.`);
  if (agentConfig.soul) parts.push(agentConfig.soul);
  if (Array.isArray(agentConfig.responsibilities) && agentConfig.responsibilities.length) {
    parts.push(`Suas responsabilidades: ${agentConfig.responsibilities.join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * Reinjeta um resumo curto do histórico recente no prompt — usado por
 * adapters de CLI SEM servidor persistente (cada chamada é isolada),
 * pra manter continuidade da conversa mesmo sem sessão real do lado
 * do CLI.
 * @param {{history: {role: string, content: string}[]}} session
 * @param {string} newMessage
 * @param {number} [maxTurns=6]
 * @returns {string}
 */
function buildPromptWithHistory(session, newMessage, maxTurns = 6) {
  const recent = (session.history || []).slice(-maxTurns);
  if (recent.length === 0) return newMessage;

  const context = recent
    .map((turn) => `${turn.role === "user" ? "Usuário" : "Você"}: ${turn.content}`)
    .join("\n");
  return `Contexto da conversa até agora:\n${context}\n\nNova mensagem: ${newMessage}`;
}

module.exports = { RuntimeAdapter, buildSystemPromptFromAgentConfig, buildPromptWithHistory };