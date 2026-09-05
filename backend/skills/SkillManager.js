/**
 * SkillManager.js
 *
 * Regras de negócio da aba "Skills": instalar/desinstalar uma skill em
 * QUALQUER CLI de agente que o usuário escolher (OpenCode, Claude Code,
 * Codex CLI, ...), sempre em escopo GLOBAL (recomendado) — ou seja, na
 * pasta de skills globais daquele CLI, disponível pra qualquer projeto/
 * runtime na máquina, não só o CompanyLab.
 *
 * "Instalar" aqui é simples e transparente de propósito: escrever um
 * arquivo `<pasta-global-do-cli>/<slug>/SKILL.md` com frontmatter YAML
 * (name + description) seguido do corpo em Markdown. É exatamente o
 * formato "Agent Skills" que OpenCode, Claude Code e Codex (via
 * .agents/skills, compatível) já sabem descobrir sozinhos — nenhum
 * desses CLIs precisa saber que o CompanyLab existe.
 *
 * NADA disso depende do CLI estar rodando: é só escrita de arquivo. Por
 * isso permitimos instalar mesmo num CLI que o runtime:detect não achou
 * no PATH agora — a pasta fica pronta pra quando o usuário instalar/
 * configurar o PATH depois.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const defaultConfig = require("../../config/default.json");
const SkillRepository = require("../repositories/SkillRepository");
const { LIBRARY_SKILLS } = require("./skillLibrary");

// name/slug tem que seguir a mesma regra que o padrão Agent Skills exige
// (OpenCode valida exatamente isso, e é uma boa regra pra qualquer CLI):
// minúsculo, números, hífen simples como separador, 1-64 chars, sem
// começar/terminar com hífen, sem hífen duplo.
const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Expande um `~` inicial pro home do usuário. Caminhos absolutos passam direto. */
function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** Monta o SKILL.md completo (frontmatter + corpo) a partir de uma linha de skill_packages. */
function buildSkillMd(skill) {
  const frontmatter = ["---", `name: ${skill.slug}`, `description: ${skill.description}`, "---", ""].join("\n");
  return frontmatter + skill.content.trim() + "\n";
}

class SkillManager {
  /**
   * Roda uma vez no boot: garante que toda skill da biblioteca pronta
   * (skillLibrary.js) existe em skill_packages. Idempotente — se o
   * slug já existe, não sobrescreve (assim, se o usuário editar uma
   * skill de biblioteca, a edição dele não é perdida em updates futuros
   * do CompanyLab que adicionem mais skills à lista).
   */
  async seedLibrary() {
    for (const skill of LIBRARY_SKILLS) {
      const existing = await SkillRepository.getBySlug(skill.slug);
      if (existing) continue;
      await SkillRepository.create({
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source: "library",
      });
    }
  }

  /**
   * Lista os CLIs onde é possível instalar uma skill (todo runtime tipo
   * "cli" que tenha `skillsGlobalDir` configurado em config/default.json —
   * runtimes locais tipo Ollama/LM Studio não têm conceito de skill).
   * @returns {{name: string, globalSkillsDir: string}[]}
   */
  listSkillTargets() {
    const runtimes = defaultConfig.runtimes || {};
    return Object.entries(runtimes)
      .filter(([, cfg]) => cfg.type === "cli" && cfg.skillsGlobalDir)
      .map(([name, cfg]) => ({ name, globalSkillsDir: expandHome(cfg.skillsGlobalDir) }));
  }

  /** @throws se o nome não servir de slug/pasta/frontmatter válido em nenhum CLI. */
  validateSlug(slug) {
    if (!slug || !SLUG_REGEX.test(slug) || slug.length > 64) {
      throw new Error(
        `Nome de skill inválido: "${slug}". Use só letras minúsculas, números e hífen simples (ex: "meu-skill-legal").`
      );
    }
  }

  /**
   * Instala uma skill (já salva em skill_packages) nos CLIs pedidos.
   * @param {string} skillId
   * @param {string[]} runtimeNames - nomes batendo com config.runtimes (ex: "OpenCode")
   * @returns {Promise<{name: string, success: boolean, path?: string, error?: string}[]>}
   */
  async installSkill(skillId, runtimeNames = []) {
    const skill = await SkillRepository.getById(skillId);
    if (!skill) throw new Error(`Skill "${skillId}" não encontrada.`);

    const targets = this.listSkillTargets();
    const md = buildSkillMd(skill);
    const results = [];

    for (const runtimeName of runtimeNames) {
      const target = targets.find((t) => t.name === runtimeName);
      if (!target) {
        results.push({ name: runtimeName, success: false, error: "CLI sem pasta de skills configurada." });
        continue;
      }

      try {
        const skillDir = path.join(target.globalSkillsDir, skill.slug);
        fs.mkdirSync(skillDir, { recursive: true });
        const filePath = path.join(skillDir, "SKILL.md");
        fs.writeFileSync(filePath, md, "utf8");

        await SkillRepository.upsertInstallation({ skillId, runtimeName, installPath: filePath });
        results.push({ name: runtimeName, success: true, path: filePath });
      } catch (err) {
        results.push({ name: runtimeName, success: false, error: err.message });
      }
    }

    return results;
  }

  /** Remove a pasta da skill de um CLI específico e apaga o registro de instalação. */
  async uninstallSkill(skillId, runtimeName) {
    const skill = await SkillRepository.getById(skillId);
    if (!skill) throw new Error(`Skill "${skillId}" não encontrada.`);

    const target = this.listSkillTargets().find((t) => t.name === runtimeName);
    if (target) {
      const skillDir = path.join(target.globalSkillsDir, skill.slug);
      try {
        fs.rmSync(skillDir, { recursive: true, force: true });
      } catch (err) {
        // Best-effort: se o diretório já não existe ou não pode ser
        // removido, ainda assim limpamos o registro no banco — não faz
        // sentido a UI continuar mostrando "instalado" por causa disso.
        console.warn(`[SkillManager] Falha ao remover pasta de "${skill.slug}" em ${runtimeName}:`, err.message);
      }
    }

    await SkillRepository.removeInstallation(skillId, runtimeName);
  }

  /** Apaga a skill inteira: desinstala de todo CLI onde estava, depois remove o registro. */
  async deleteSkill(skillId) {
    const installations = await SkillRepository.getInstallationsForSkill(skillId);
    for (const installation of installations) {
      await this.uninstallSkill(skillId, installation.runtime_name);
    }
    await SkillRepository.delete(skillId);
  }
}

module.exports = new SkillManager();