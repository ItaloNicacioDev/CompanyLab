/**
 * CodexAdapter.js
 *
 * Mesmo padrão do ClaudeCodeAdapter: o Codex CLI é chamado no modo
 * não-interativo (`codex exec "<prompt>"`), escondido, uma chamada
 * isolada por mensagem — nunca abre a UI interativa de terminal. O
 * histórico é mantido pelo CompanyLab, igual ao ClaudeCodeAdapter.
 *
 * NOTA: `exec` é o subcomando não-interativo documentado do Codex CLI
 * no momento em que este arquivo foi escrito. Se a versão instalada
 * usar outro nome de subcomando, rode `codex --help` e ajuste a
 * constante de args abaixo — é só isso que muda.
 */

const crypto = require("crypto");
const { RuntimeAdapter, buildSystemPromptFromAgentConfig, buildPromptWithHistory } = require("../RuntimeAdapter");

class CodexAdapter extends RuntimeAdapter {
  /** @param {object} [options] @param {string} [options.cliCommand='codex'] */
  constructor({ cliCommand = "codex" } = {}) {
    super("Codex");
    this.cliCommand = cliCommand;
    /** @type {Map<string, {systemPrompt: string, history: {role:string, content:string}[]}>} */
    this._sessions = new Map();
  }

  async isAvailable() {
    try {
      await this.runHiddenAndCapture(this.cliCommand, ["--version"], { timeoutMs: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /** @param {object} agentConfig @returns {Promise<string>} */
  async createSession(agentConfig = {}) {
    const sessionId = crypto.randomUUID();
    this._sessions.set(sessionId, {
      systemPrompt: buildSystemPromptFromAgentConfig(agentConfig),
      history: [],
    });
    return sessionId;
  }

  /** @param {string} sessionId @param {string} message @returns {Promise<string>} */
  async sendMessage(sessionId, message) {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new Error(`[Codex] Sessão "${sessionId}" não existe (createSession não foi chamado?).`);
    }

    // Injeta a identidade do agente junto do prompt (Codex 'exec' não
    // tem um flag separado de system prompt tão bem documentado quanto
    // o Claude Code, então vai tudo junto no próprio texto).
    const prefixed = session.systemPrompt ? `${session.systemPrompt}\n\n${message}` : message;
    const prompt = buildPromptWithHistory(session, prefixed);

    const output = await this.runHiddenAndCapture(this.cliCommand, ["exec", prompt], { timeoutMs: 180000 });
    const reply = output.trim();

    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: reply });

    return reply;
  }

  async endSession(sessionId) {
    this._sessions.delete(sessionId);
  }
}

module.exports = { CodexAdapter };