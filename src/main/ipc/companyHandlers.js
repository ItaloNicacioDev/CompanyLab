/**
 * companyHandlers.js
 *
 * Handlers IPC pra customização (opcional) da empresa — nome, cor de
 * destaque, descrição, emoji/logo. Pedido do usuário: "quero uma opção
 * pra personalizar a empresa, como opcional, e deve ficar em
 * configurações".
 *
 * NOTA DE SCHEMA: igual ao departmentHandlers.js faz com `rules`, os
 * campos de customização vivem dentro da coluna `companies.config`
 * (já existe desde 001_initial.sql, só nunca tinha sido usada pra
 * nada além do JSON que defaultCompany.js grava na criação).
 */

const { run, get } = require("../../../backend/database/db");
const { getDefaultCompanyId } = require("../../../backend/database/defaultCompany");
const EventBus = require("../../../core/events/EventBus");
const { EVENT_TYPES } = require("../../../core/events/eventTypes");

function safeParseJSON(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapCompanyRow(row) {
  const config = safeParseJSON(row.config, {});
  return {
    id: row.id,
    name: row.name,
    description: config.description || "",
    // null = nenhuma cor própria escolhida -> segue o --accent do tema ativo
    // (ver Temas). Só vira uma string quando o usuário mexe de propósito no
    // seletor de cor em Configurações.
    accentColor: config.accentColor || null,
    emoji: config.emoji || "🏢",
    tagline: config.tagline || "",
    theme: config.theme || "dark",
    createdAt: row.created_at,
  };
}

/** @param {import('electron').IpcMain} ipcMain */
function registerCompanyHandlers(ipcMain) {
  ipcMain.handle("company:get", async () => {
    const companyId = await getDefaultCompanyId();
    const row = await get("SELECT * FROM companies WHERE id = ?", [companyId]);
    return row ? mapCompanyRow(row) : null;
  });

  ipcMain.handle("company:update", async (_event, updates = {}) => {
    const companyId = await getDefaultCompanyId();
    const current = await get("SELECT * FROM companies WHERE id = ?", [companyId]);
    if (!current) return { success: false, error: "Empresa não encontrada." };

    const currentConfig = safeParseJSON(current.config, {});
    const mergedConfig = {
      ...currentConfig,
      description: updates.description ?? currentConfig.description ?? "",
      // undefined (campo nem enviado nesse update) -> mantém o que já tinha.
      // null (enviado explicitamente) -> limpa a customização, volta a
      // seguir a cor do tema ativo.
      accentColor: updates.accentColor !== undefined ? updates.accentColor : (currentConfig.accentColor ?? null),
      emoji: updates.emoji ?? currentConfig.emoji ?? "🏢",
      tagline: updates.tagline ?? currentConfig.tagline ?? "",
      theme: updates.theme ?? currentConfig.theme ?? "dark",
    };

    const name = (updates.name ?? current.name ?? "").trim() || current.name;

    await run("UPDATE companies SET name = ?, config = ? WHERE id = ?", [
      name,
      JSON.stringify(mergedConfig),
      companyId,
    ]);

    const row = await get("SELECT * FROM companies WHERE id = ?", [companyId]);
    const company = mapCompanyRow(row);

    // Não existe COMPANY_UPDATED em eventTypes.js ainda — reaproveitamos
    // COMPANY_STATE_SYNCED (já existe, já é válido), que é justamente
    // "algo mudou no estado geral da empresa, sincronizem quem precisar".
    EventBus.emitEvent(EVENT_TYPES.COMPANY_STATE_SYNCED, { company });

    return { success: true, company };
  });
}

module.exports = registerCompanyHandlers;