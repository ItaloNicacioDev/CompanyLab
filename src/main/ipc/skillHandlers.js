/**
 * skillHandlers.js
 *
 * Handlers IPC da aba "Skills": listar biblioteca pronta + skills
 * próprias do usuário, criar/editar/apagar skill própria, e instalar/
 * desinstalar em qualquer CLI de agente (sempre escopo global).
 */

const defaultConfig = require("../../../config/default.json");
const SkillRepository = require("../../../backend/repositories/SkillRepository");
const SkillManager = require("../../../backend/skills/SkillManager");
const { detectCli } = require("./runtimeHandlers");

/** Converte a linha crua do SQLite pro formato que o renderer consome. */
function mapSkillRow(row, installations) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    source: row.source, // 'library' | 'custom'
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Mapa runtimeName -> caminho instalado, só com os runtimes onde ESSA skill está.
    installedIn: Object.fromEntries(
      installations.filter((i) => i.skill_id === row.id).map((i) => [i.runtime_name, i.install_path])
    ),
  };
}

/** @param {import('electron').IpcMain} ipcMain */
function registerSkillHandlers(ipcMain) {
  ipcMain.handle("skill:listAll", async () => {
    const [rows, installations] = await Promise.all([
      SkillRepository.getAll(),
      SkillRepository.getAllInstallations(),
    ]);
    return rows.map((row) => mapSkillRow(row, installations));
  });

  // CLIs onde dá pra instalar skill + se cada um está instalado no PATH
  // agora (só informativo — instalar não exige o CLI estar detectado,
  // ver nota em SkillManager.js).
  ipcMain.handle("skill:listTargets", async () => {
    const targets = SkillManager.listSkillTargets();
    return targets.map((t) => {
      const cliCommand = defaultConfig.runtimes?.[t.name]?.cli;
      const { installed } = cliCommand ? detectCli(cliCommand) : { installed: false };
      return { name: t.name, globalSkillsDir: t.globalSkillsDir, installed };
    });
  });

  ipcMain.handle("skill:create", async (_event, data = {}) => {
    const slug = (data.slug || "").trim().toLowerCase();
    try {
      SkillManager.validateSlug(slug);
    } catch (err) {
      return { success: false, error: err.message };
    }

    const existing = await SkillRepository.getBySlug(slug);
    if (existing) return { success: false, error: `Já existe uma skill com o nome "${slug}".` };

    const description = (data.description || "").trim();
    if (!description) return { success: false, error: "Descrição é obrigatória (é o que faz o agente saber quando usar a skill)." };

    const skill = await SkillRepository.create({
      slug,
      name: (data.name || slug).trim(),
      description,
      content: (data.content || "").trim() || "# " + slug + "\n\nDescreva aqui as instruções da skill.",
      source: "custom",
    });
    return { success: true, skill };
  });

  ipcMain.handle("skill:update", async (_event, { id, name, description, content } = {}) => {
    const existing = await SkillRepository.getById(id);
    if (!existing) return { success: false, error: "Skill não encontrada." };
    if (existing.source !== "custom") {
      return { success: false, error: "Skills da biblioteca não podem ser editadas — crie uma sua." };
    }

    const skill = await SkillRepository.update(id, {
      name: (name ?? existing.name).trim(),
      description: (description ?? existing.description).trim(),
      content: (content ?? existing.content).trim(),
    });

    // A skill pode já estar instalada em algum CLI — reinstala nesses
    // mesmos CLIs pra propagar a edição pro arquivo SKILL.md já copiado.
    const installations = await SkillRepository.getInstallationsForSkill(id);
    if (installations.length) {
      await SkillManager.installSkill(id, installations.map((i) => i.runtime_name));
    }

    return { success: true, skill };
  });

  ipcMain.handle("skill:delete", async (_event, id) => {
    const existing = await SkillRepository.getById(id);
    if (!existing) return { success: false, error: "Skill não encontrada." };
    if (existing.source !== "custom") {
      return { success: false, error: "Skills da biblioteca não podem ser apagadas." };
    }
    await SkillManager.deleteSkill(id);
    return { success: true };
  });

  ipcMain.handle("skill:install", async (_event, { skillId, runtimeNames } = {}) => {
    try {
      const results = await SkillManager.installSkill(skillId, runtimeNames || []);
      return { success: true, results };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("skill:uninstall", async (_event, { skillId, runtimeName } = {}) => {
    try {
      await SkillManager.uninstallSkill(skillId, runtimeName);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = registerSkillHandlers;