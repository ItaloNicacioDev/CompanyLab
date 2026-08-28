/**
 * RoomFactory.js
 *
 * Orquestra a construção de salas 3D por departamento:
 *  - Decide o template certo via roomTemplates/registry.js
 *  - Cacheia o THREE.Group já construído (não reconstrói à toa)
 *  - Quando a sala não veio de um template fixo exato (ou seja, foi
 *    composta por tags via generic.js), salva um "descriptor" JSON em
 *    disco pra registrar como aquela sala foi decidida — e pra
 *    reconstrução ficar determinística mesmo se a lógica de matching
 *    evoluir depois (seção 22/24 do spec: sala nasce do estado real
 *    do departamento).
 *
 * NOTA DE INTEGRAÇÃO: por padrão os descriptors são salvos dentro do
 * próprio pacote da aplicação (`roomTemplates/custom/`), o que é ótimo
 * pra desenvolvimento e para os testes deste arquivo. Mas depois de
 * instalado via NSIS, a pasta de instalação (Program Files) costuma
 * ser SOMENTE LEITURA pro usuário comum. Quando o `main.js`/`preload.js`
 * estiverem prontos, o `SceneManager` deve criar o RoomFactory passando
 * `storageDir: <userData>/rooms/custom` (via `app.getPath('userData')`
 * recebido do processo principal) em vez do valor padrão daqui.
 */

const fs = require("fs");
const path = require("path");
const registry = require("./roomTemplates/registry");

const DEFAULT_STORAGE_DIR = path.join(__dirname, "roomTemplates", "custom");

/** Converte "#3b82f6" (como vem de um color picker) para 0x3b82f6. Passa números direto. */
function toColorNumber(color) {
  if (typeof color === "number") return color;
  if (typeof color === "string" && color.startsWith("#")) {
    return parseInt(color.slice(1), 16);
  }
  return undefined; // deixa o template usar a cor padrão dele
}

/** Chave estável pra comparar arrays de tags no cache, independente da ordem. */
function tagsKey(tags = []) {
  return [...tags].sort().join("|");
}

class RoomFactory {
  /**
   * @param {object} [options]
   * @param {string} [options.storageDir] - onde salvar descriptors de salas customizadas
   */
  constructor({ storageDir = DEFAULT_STORAGE_DIR } = {}) {
    this.storageDir = storageDir;
    this._cache = new Map(); // departmentId -> { group, meta }

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  _descriptorPath(departmentId) {
    return path.join(this.storageDir, `${departmentId}.json`);
  }

  /** @param {string} departmentId @returns {object|null} */
  loadDescriptor(departmentId) {
    const file = this._descriptorPath(departmentId);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.warn(
        `[RoomFactory] Descriptor corrompido para "${departmentId}", ignorando: ${err.message}`
      );
      return null;
    }
  }

  saveDescriptor(departmentId, descriptor) {
    fs.writeFileSync(this._descriptorPath(departmentId), JSON.stringify(descriptor, null, 2), "utf8");
  }

  deleteDescriptor(departmentId) {
    const file = this._descriptorPath(departmentId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  /**
   * Constrói (ou reaproveita do cache) o THREE.Group de um departamento.
   *
   * @param {object} department
   * @param {string} department.id
   * @param {string} department.name
   * @param {string} [department.roomType] - ex: 'development', 'custom'
   * @param {string[]} [department.tags] - tags de função (departamentos customizados)
   * @param {string|number} [department.accentColor] - '#3b82f6' ou 0x3b82f6
   * @param {number} [department.employeeCount=2]
   * @param {object} [options]
   * @param {boolean} [options.forceRebuild=false]
   * @returns {import('three').Group}
   */
  getOrBuildRoom(department, { forceRebuild = false } = {}) {
    const employeeCount = department.employeeCount ?? 2;
    const accentColor = toColorNumber(department.accentColor);
    const descriptor = this.loadDescriptor(department.id);
    const tags = department.tags ?? descriptor?.tags ?? [];
    const currentTagsKey = tagsKey(tags);

    const cached = this._cache.get(department.id);
    const unchanged =
      cached &&
      cached.meta.employeeCount === employeeCount &&
      cached.meta.roomType === department.roomType &&
      cached.meta.accentColor === accentColor &&
      cached.meta.tagsKey === currentTagsKey;

    if (!forceRebuild && unchanged) {
      return cached.group;
    }

    if (cached) this._disposeGroup(cached.group);

    const resolved = registry.resolveTemplate({ roomType: department.roomType, tags });

    const group = resolved.build({ employeeCount, accentColor, tags });

    group.userData.departmentId = department.id;
    group.userData.departmentName = department.name;
    group.userData.matchedBy = resolved.matchedBy;

    // Só persiste descriptor quando a sala NÃO veio de um template fixo
    // exato e ainda não existe um salvo — isso é o que garante que uma
    // sala customizada seja reconstruída do mesmo jeito da próxima vez.
    if (resolved.matchedBy !== "exact" && !descriptor) {
      this.saveDescriptor(department.id, {
        roomType: department.roomType,
        tags,
        matchedBy: resolved.matchedBy,
        resolvedTemplate: resolved.ROOM_TYPE,
        createdAt: new Date().toISOString(),
      });
    }

    this._cache.set(department.id, {
      group,
      meta: { employeeCount, roomType: department.roomType, accentColor, tagsKey: currentTagsKey },
    });

    return group;
  }

  /** Descarta o cache em memória de um departamento (mas mantém o descriptor em disco). */
  invalidate(departmentId) {
    const cached = this._cache.get(departmentId);
    if (cached) {
      this._disposeGroup(cached.group);
      this._cache.delete(departmentId);
    }
  }

  /** Remove departamento por completo: cache + descriptor em disco (uso: departamento deletado). */
  removeDepartment(departmentId) {
    this.invalidate(departmentId);
    this.deleteDescriptor(departmentId);
  }

  /** Libera geometrias/materiais do THREE.Group pra não vazar memória (seção 39 — production quality). */
  _disposeGroup(group) {
    group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}

module.exports = { RoomFactory, toColorNumber };