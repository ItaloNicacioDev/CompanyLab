/**
 * SkillRepository.js
 *
 * Abstrai todas as queries SQL relacionadas a 'skill_packages' (biblioteca
 * pronta + skills criadas pelo usuário) e 'skill_installations' (em quais
 * CLIs cada skill foi copiada).
 */

const db = require("../database/db");
const { generateId } = require("../utils/id.js");

class SkillRepository {
  async getAll() {
    return db.all("SELECT * FROM skill_packages ORDER BY source ASC, name ASC");
  }

  async getById(id) {
    return db.get("SELECT * FROM skill_packages WHERE id = ?", [id]);
  }

  async getBySlug(slug) {
    return db.get("SELECT * FROM skill_packages WHERE slug = ?", [slug]);
  }

  async create({ slug, name, description, content, source = "custom" }) {
    const id = generateId("skill");
    await db.run(
      `INSERT INTO skill_packages (id, slug, name, description, source, content)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, slug, name, description, source, content]
    );
    return this.getById(id);
  }

  async update(id, { name, description, content }) {
    await db.run(
      `UPDATE skill_packages
       SET name = ?, description = ?, content = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, description, content, id]
    );
    return this.getById(id);
  }

  async delete(id) {
    return db.run("DELETE FROM skill_packages WHERE id = ?", [id]);
  }

  // ─── Instalações (quais CLIs têm essa skill, e onde) ────────────────────

  async getInstallationsForSkill(skillId) {
    return db.all("SELECT * FROM skill_installations WHERE skill_id = ?", [skillId]);
  }

  async getAllInstallations() {
    return db.all("SELECT * FROM skill_installations");
  }

  async upsertInstallation({ skillId, runtimeName, installPath }) {
    return db.run(
      `INSERT INTO skill_installations (skill_id, runtime_name, install_path)
       VALUES (?, ?, ?)
       ON CONFLICT(skill_id, runtime_name)
       DO UPDATE SET install_path = excluded.install_path, installed_at = CURRENT_TIMESTAMP`,
      [skillId, runtimeName, installPath]
    );
  }

  async removeInstallation(skillId, runtimeName) {
    return db.run(
      "DELETE FROM skill_installations WHERE skill_id = ? AND runtime_name = ?",
      [skillId, runtimeName]
    );
  }

  async removeAllInstallationsForSkill(skillId) {
    return db.run("DELETE FROM skill_installations WHERE skill_id = ?", [skillId]);
  }
}

module.exports = new SkillRepository();