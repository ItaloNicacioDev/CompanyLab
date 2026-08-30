/**
 * defaultCompany.js
 *
 * O schema exige `company_id` em agents/departments/projects, mas ainda
 * não existe nenhuma tela de "criar empresa" (isso é trabalho futuro,
 * de onboarding). Enquanto isso não existe, este módulo garante que
 * sempre há pelo menos UMA empresa no banco — criando-a com o nome de
 * `config/default.json` na primeira vez que qualquer handler precisar
 * de um `company_id`.
 *
 * Cacheado em memória depois da primeira consulta pra não bater no
 * banco de novo a cada chamada de agent:create/department:create/etc.
 */

const { run, get } = require("./db");
const { generateId } = require("../utils/id");
const defaultConfig = require("../../config/default.json");

let cachedCompanyId = null;

/** @returns {Promise<string>} id da empresa (existente ou recém-criada) */
async function getDefaultCompanyId() {
  if (cachedCompanyId) return cachedCompanyId;

  const existing = await get("SELECT id FROM companies ORDER BY created_at ASC LIMIT 1");
  if (existing) {
    cachedCompanyId = existing.id;
    return cachedCompanyId;
  }

  const id = generateId("company");
  const name = defaultConfig?.company?.name || "My Company";
  await run("INSERT INTO companies (id, name, config) VALUES (?, ?, ?)", [
    id,
    name,
    JSON.stringify(defaultConfig?.company || {}),
  ]);

  cachedCompanyId = id;
  return id;
}

/** Só pra testes: limpa o cache em memória (não afeta o banco). */
function _resetCache() {
  cachedCompanyId = null;
}

module.exports = { getDefaultCompanyId, _resetCache };