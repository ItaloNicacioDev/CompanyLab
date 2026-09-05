/**
 * runtimeHandlers.js
 *
 * Handler IPC de detecção de runtimes (seção 16/17 do spec).
 * runtime:detect já é chamado pelo renderer.js atual.
 *
 * Detecta tanto CLIs no PATH do sistema (OpenCode/Codex/Claude Code)
 * quanto servidores locais compatíveis com a API da OpenAI (Ollama,
 * LM Studio, llama.cpp — ver config/default.json "runtimes").
 */

const { execFileSync } = require("child_process");
const defaultConfig = require("../../../config/default.json");
const { ENHANCED_PATH } = require("../../../backend/runtimes/RuntimeAdapter");

const DETECT_TIMEOUT_MS = 3000;

/** Tenta rodar `<cli> --version`; distingue "não instalado" de "instalado mas sem esse flag". */
function detectCli(cliName) {
  try {
    const output = execFileSync(cliName, ["--version"], {
      timeout: DETECT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
      // Mesmo PATH ampliado usado na hora de rodar de verdade (RuntimeAdapter.js)
      // — sem isso essa detecção podia dizer "não instalado" enquanto a
      // detecção real (usada pelo chat) já achava a CLI, uma divergindo da outra.
      env: { ...process.env, PATH: ENHANCED_PATH },
    });
    return { installed: true, version: output.toString().trim().split("\n")[0] || "desconhecida" };
  } catch (err) {
    if (err.code === "ENOENT") return { installed: false, version: null };
    // Binário existe (foi encontrado e executado), só não gostou do
    // flag --version ou retornou erro — ainda assim conta como instalado.
    return { installed: true, version: "desconhecida" };
  }
}

/** Consulta `<baseUrl>/v1/models` (padrão OpenAI-compatible) com timeout curto. */
async function detectLocalRuntime(baseUrl) {
  if (!baseUrl) return { installed: false, version: null, models: [] };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

    const response = await fetch(`${baseUrl}/v1/models`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return { installed: false, version: null, models: [] };

    const data = await response.json();
    const models = (data?.data || []).map((m) => m.id).filter(Boolean);

    return {
      installed: true,
      version: `${models.length} modelo(s) disponível(is)`,
      models,
    };
  } catch (_err) {
    return { installed: false, version: null, models: [] };
  }
}

/** @param {import('electron').IpcMain} ipcMain */
function registerRuntimeHandlers(ipcMain) {
  ipcMain.handle("runtime:detect", async () => {
    const runtimes = defaultConfig.runtimes || {};
    const results = [];

    for (const [name, cfg] of Object.entries(runtimes)) {
      if (cfg.type === "cli") {
        const { installed, version } = detectCli(cfg.cli);
        results.push({ name, type: "cli", installed, version, installUrl: cfg.installUrl || null });
      } else if (cfg.type === "local") {
        const { installed, version, models } = await detectLocalRuntime(cfg.baseUrl);
        results.push({ name, type: "local", installed, version, models, baseUrl: cfg.baseUrl });
      }
    }

    return results;
  });

  ipcMain.handle("runtime:install", async (_event, runtimeName) => {
    const cfg = defaultConfig.runtimes?.[runtimeName];
    // Instalação automática de CLI de terceiros é um recurso maior
    // (baixar/rodar instalador) que ainda não foi implementado —
    // por enquanto só devolve o link pro usuário instalar manualmente.
    return {
      success: false,
      message: "Instalação automática ainda não implementada.",
      installUrl: cfg?.installUrl || null,
    };
  });
}

module.exports = registerRuntimeHandlers;
// Exportado à parte pra skillHandlers.js poder saber se um CLI (ex:
// "opencode") está instalado no PATH, sem duplicar a lógica de detecção
// nem criar acoplamento circular entre os dois módulos de handler.
module.exports.detectCli = detectCli;