/**
 * ClaudeCodeAdapter.js
 *
 * O Claude Code CLI não tem um modo servidor HTTP persistente como o
 * OpenCode, então cada mensagem vira uma chamada ISOLADA e ESCONDIDA
 * (`claude -p "<prompt>"`, modo não-interativo/"print" — imprime a
 * resposta e sai, sem abrir a UI interativa de terminal). O histórico
 * da conversa é mantido pelo próprio CompanyLab e reinjetado a cada
 * chamada, pra manter continuidade mesmo sem sessão persistente do
 * lado da CLI.
 *
 * NOTA: os flags exatos (`-p`, `--append-system-prompt`) seguem a
 * documentação pública do Claude Code CLI no momento em que este
 * arquivo foi escrito. Se a versão instalada usar flags diferentes,
 * rode `claude --help` e ajuste as constantes/args abaixo — é só isso
 * que muda.
 */

const crypto = require("crypto");
const { RuntimeAdapter, buildSystemPromptFromAgentConfig, buildPromptWithHistory } = require("../RuntimeAdapter");

class ClaudeCodeAdapter extends RuntimeAdapter {
  /** @param {object} [options] @param {string} [options.cliCommand='claude'] */
  constructor({ cliCommand = "claude" } = {}) {
    super("Claude Code");
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
      throw new Error(`[Claude Code] Sessão "${sessionId}" não existe (createSession não foi chamado?).`);
    }

    const prompt = buildPromptWithHistory(session, message);
    const args = ["-p", prompt];
    if (session.systemPrompt) {
      args.push("--append-system-prompt", session.systemPrompt);
    }

    const output = await this.runHiddenAndCapture(this.cliCommand, args, { timeoutMs: 120000 });
    const reply = output.trim();

    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: reply });

    return reply;
  }

  async endSession(sessionId) {
    this._sessions.delete(sessionId);
  }
}

module.exports = { ClaudeCodeAdapter };