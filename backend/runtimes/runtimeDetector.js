/**
 * runtimeDetector.js
 *
 * Duas responsabilidades:
 *  1. `createAdapterForRuntime()` — fábrica que lê uma entrada de
 *     `config/default.json` (runtimes.*) e devolve o Adapter certo,
 *     já instanciado. É isso que o core/orchestrator/ vai usar pra
 *     pegar um adapter funcional pra QUALQUER agente, sem precisar de
 *     um switch/case espalhado pelo código sabendo qual runtime é qual.
 *  2. `detectAllRuntimes()` — detecção real de disponibilidade, usando
 *     os PRÓPRIOS adapters (o mesmo isAvailable() que vai ser usado de
 *     verdade na hora de abrir uma sessão). Assim "aparece como
 *     instalado" e "consigo usar de fato" nunca divergem.
 *
 * NOTA: `src/main/ipc/runtimeHandlers.js` hoje tem sua própria
 * detecção mais simples (só pra popular a tela de runtimes rapidinho)
 * e continua funcionando standalone. Este arquivo é a versão completa,
 * pronta pra quando o Orchestrator precisar de adapters de verdade.
 */

const { OpenCodeAdapter } = require("./CLI/OpenCodeAdapter");
const { CodexAdapter } = require("./CLI/CodexAdapter");
const { ClaudeCodeAdapter } = require("./CLI/ClaudeCodeAdapter");
const { LocalOpenAICompatibleAdapter } = require("./local/LocalOpenAICompatibleAdapter");

const ollamaPreset = require("./presets/ollama");
const lmstudioPreset = require("./presets/lmstudio");
const llamacppPreset = require("./presets/llamacpp");
const customPreset = require("./presets/custom");

const ADAPTER_CLASSES = Object.freeze({
  OpenCodeAdapter,
  CodexAdapter,
  ClaudeCodeAdapter,
  LocalOpenAICompatibleAdapter,
});

const LOCAL_PRESETS = Object.freeze({
  ollama: ollamaPreset,
  lmstudio: lmstudioPreset,
  llamacpp: llamacppPreset,
  custom: customPreset,
});

/**
 * Cria (sem cachear) a instância de adapter certa pra uma entrada de
 * runtime do config/default.json.
 * @param {string} runtimeName - ex: "OpenCode", "Local (Ollama)"
 * @param {object} runtimeConfig - a entrada correspondente em config.runtimes
 * @returns {import('./RuntimeAdapter').RuntimeAdapter}
 */
function createAdapterForRuntime(runtimeName, runtimeConfig) {
  const AdapterClass = ADAPTER_CLASSES[runtimeConfig.adapter];
  if (!AdapterClass) {
    throw new Error(
      `[runtimeDetector] Nenhum adapter registrado para "${runtimeConfig.adapter}" (runtime "${runtimeName}").`
    );
  }

  if (runtimeConfig.type === "cli") {
    return new AdapterClass({ cliCommand: runtimeConfig.cli });
  }

  if (runtimeConfig.type === "local") {
    const preset = LOCAL_PRESETS[runtimeConfig.preset] || LOCAL_PRESETS.custom;
    return new AdapterClass({
      displayName: runtimeName,
      baseUrl: runtimeConfig.baseUrl || preset.baseUrl,
      chatEndpoint: preset.chatEndpoint,
      modelsEndpoint: preset.modelsEndpoint,
    });
  }

  throw new Error(`[runtimeDetector] Tipo de runtime desconhecido: "${runtimeConfig.type}" (runtime "${runtimeName}").`);
}

/**
 * Detecta disponibilidade real de TODOS os runtimes configurados,
 * usando os adapters de verdade em paralelo.
 * @param {Record<string, object>} runtimesConfig - config.runtimes (de config/default.json)
 * @returns {Promise<Array<{name: string, type: string, installed: boolean, error?: string}>>}
 */
async function detectAllRuntimes(runtimesConfig) {
  const entries = Object.entries(runtimesConfig || {});

  return Promise.all(
    entries.map(async ([name, cfg]) => {
      try {
        const adapter = createAdapterForRuntime(name, cfg);
        const installed = await adapter.isAvailable();
        return { name, type: cfg.type, installed };
      } catch (err) {
        return { name, type: cfg.type, installed: false, error: err.message };
      }
    })
  );
}

module.exports = { createAdapterForRuntime, detectAllRuntimes, ADAPTER_CLASSES, LOCAL_PRESETS };