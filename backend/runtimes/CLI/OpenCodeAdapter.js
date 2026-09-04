/**
 * OpenCodeAdapter.js
 *
 * IMPORTANTE (reescrito): a suposição original deste arquivo era que o
 * OpenCode só falava por um servidor HTTP persistente (`opencode
 * serve`). Na prática (confirmado testando com o usuário), o binário
 * instalado não sobe nenhum "serviço próprio" — ele funciona como
 * chamada ISOLADA e ESCONDIDA por mensagem:
 *
 *     opencode run "<prompt>"
 *
 * que imprime a resposta e sai — exatamente o mesmo padrão do
 * ClaudeCodeAdapter.js (`claude -p "<prompt>"`). Trocamos a
 * implementação pra seguir esse padrão: sem servidor, sem porta, sem
 * HTTP client. O histórico da conversa é mantido pelo próprio
 * CompanyLab e reinjetado a cada chamada, igual ao Claude Code.
 *
 * Se no futuro quisermos aproveitar sessões nativas do OpenCode
 * (`opencode run -c`/`-s <id>`), dá pra evoluir depois — por ora,
 * reinjetar o histórico manualmente é mais simples e não depende de
 * detalhes de versão do formato de sessão do OpenCode.
 */

const crypto = require("crypto");
const { RuntimeAdapter, buildSystemPromptFromAgentConfig, buildPromptWithHistory } = require("../RuntimeAdapter");

class OpenCodeAdapter extends RuntimeAdapter {
  /** @param {object} [options] @param {string} [options.cliCommand='opencode'] */
  constructor({ cliCommand = "opencode" } = {}) {
    super("OpenCode");
    this.cliCommand = cliCommand;
    /** @type {Map<string, {systemPrompt: string, history: {role:string, content:string}[]}>} */
    this._sessions = new Map();
    this.lastError = null;
  }

  async isAvailable() {
    try {
      await this.runHiddenAndCapture(this.cliCommand, ["--version"], { timeoutMs: 5000 });
      return true;
    } catch (err) {
      this.lastError = err.message;
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
      throw new Error(`[OpenCode] Sessão "${sessionId}" não existe (createSession não foi chamado?).`);
    }

    const historyPrompt = buildPromptWithHistory(session, message);
    // OpenCode (nessa instalação) não expõe uma flag equivalente ao
    // `--append-system-prompt` do Claude Code, então fixamos a
    // identidade do agente prependendo o texto ao próprio prompt —
    // funciona com qualquer versão, já que não depende de nenhuma flag.
    const prompt = session.systemPrompt
      ? `${session.systemPrompt}\n\n${historyPrompt}`
      : historyPrompt;

    const output = await this.runHiddenAndCapture(this.cliCommand, ["run", prompt], { timeoutMs: 180000 });
    const reply = output.trim();

    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: reply });

    return reply;
  }

  async endSession(sessionId) {
    this._sessions.delete(sessionId);
  }
}

module.exports = { OpenCodeAdapter };