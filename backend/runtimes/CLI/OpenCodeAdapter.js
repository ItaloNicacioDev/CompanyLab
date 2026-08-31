/**
 * OpenCodeAdapter.js
 *
 * Sobe `opencode serve` ESCONDIDO (sem janela de terminal, via
 * spawnHidden do RuntimeAdapter) na primeira vez que for preciso, e
 * fala com ele via HTTP usando o OpenCodeClient que já existia em
 * js/Opencodeclient.js. O usuário nunca vê nem precisa tocar em nada
 * disso — o processo sobe e morre junto com o CompanyLab.
 */

const { RuntimeAdapter, buildSystemPromptFromAgentConfig } = require("../RuntimeAdapter");
const { OpenCodeClient } = require("../../../js/Opencodeclient");

const DEFAULT_PORT = 4096;
const SERVER_READY_TIMEOUT_MS = 15000;
const SERVER_READY_POLL_INTERVAL_MS = 300;

class OpenCodeAdapter extends RuntimeAdapter {
  /**
   * @param {object} [options]
   * @param {string} [options.cliCommand='opencode']
   * @param {number} [options.port=4096]
   */
  constructor({ cliCommand = "opencode", port = DEFAULT_PORT } = {}) {
    super("OpenCode");
    this.cliCommand = cliCommand;
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
    this.client = new OpenCodeClient(this.baseUrl);

    this._serverProcess = null;
    this._serverReadyPromise = null;
  }

  async isAvailable() {
    if (await this.client.checkHealth()) return true;
    try {
      await this._ensureServerRunning();
      return await this.client.checkHealth();
    } catch {
      return false;
    }
  }

  /**
   * Garante que `opencode serve` está rodando, subindo escondido se
   * necessário. Idempotente: chamadas concorrentes reaproveitam a
   * mesma subida em vez de tentar subir o servidor várias vezes.
   */
  async _ensureServerRunning() {
    if (await this.client.checkHealth()) return; // já tem um rodando (de uma sessão anterior, por exemplo)
    if (this._serverReadyPromise) return this._serverReadyPromise;

    // Construído com `new Promise(...)` de propósito (em vez de uma IIFE
    // async) — assim os listeners de evento do processo ('error'/'exit')
    // conseguem chamar reject() diretamente. Deixar um listener de
    // evento dar `throw` não é capturado por nenhum try/catch externo e
    // derruba o processo inteiro (bug real encontrado ao testar sem o
    // binário 'opencode' instalado).
    this._serverReadyPromise = new Promise((resolve, reject) => {
      let settled = false;

      this._serverProcess = this.spawnHidden(this.cliCommand, ["serve", "--port", String(this.port)]);

      this._serverProcess.on("exit", (code) => {
        this._log(`[OpenCode] processo 'opencode serve' encerrou (code ${code}).`);
        this._serverProcess = null;
        if (!settled) {
          settled = true;
          this._serverReadyPromise = null;
          reject(new Error(`[OpenCode] 'opencode serve' encerrou antes de ficar pronto (code ${code}).`));
        } else {
          this._serverReadyPromise = null;
        }
      });

      this._serverProcess.on("error", (err) => {
        if (!settled) {
          settled = true;
          this._serverReadyPromise = null;
          reject(new Error(`[OpenCode] Falha ao iniciar 'opencode serve': ${err.message}`));
        }
      });

      const start = Date.now();
      const poll = async () => {
        if (settled) return;
        if (await this.client.checkHealth()) {
          settled = true;
          resolve();
          return;
        }
        if (Date.now() - start >= SERVER_READY_TIMEOUT_MS) {
          settled = true;
          this._serverReadyPromise = null;
          reject(
            new Error(`[OpenCode] 'opencode serve' não respondeu em ${this.baseUrl} depois de ${SERVER_READY_TIMEOUT_MS}ms.`)
          );
          return;
        }
        setTimeout(poll, SERVER_READY_POLL_INTERVAL_MS);
      };
      poll();
    });

    return this._serverReadyPromise;
  }

  /** @param {object} agentConfig @returns {Promise<string>} */
  async createSession(agentConfig = {}) {
    await this._ensureServerRunning();

    const title = agentConfig.name ? `CompanyLab - ${agentConfig.name}` : "CompanyLab session";
    const sessionId = await this.client.createSession(title);

    // Fixa a identidade do agente (soul.md/personalidade/cargo) como a
    // primeira mensagem da sessão, antes de qualquer coisa do usuário.
    const systemPrompt = buildSystemPromptFromAgentConfig(agentConfig);
    if (systemPrompt) {
      await this.client.sendMessage(sessionId, systemPrompt);
    }

    return sessionId;
  }

  /** @param {string} sessionId @param {string} message @returns {Promise<string>} */
  async sendMessage(sessionId, message) {
    await this._ensureServerRunning();
    return this.client.sendMessage(sessionId, message);
  }

  async dispose() {
    if (this._serverProcess) {
      this._serverProcess.kill();
      this._serverProcess = null;
      this._serverReadyPromise = null;
    }
  }
}

module.exports = { OpenCodeAdapter };