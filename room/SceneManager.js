/**
 * SceneManager.js
 *
 * O motor da cena 3D inteira (seções 21-29 do spec). Roda no processo
 * RENDERER do Electron (é aqui que existe DOM/canvas/WebGL).
 *
 * Responsabilidades:
 *  - Ciclo de vida da cena Three.js (câmera, luzes, renderer, loop de animação)
 *  - Posicionar a sala de cada departamento (via RoomFactory) lado a lado
 *  - Posicionar/mover o avatar de cada agente na estação certa (via AgentAvatar)
 *  - Clique num avatar -> callback com os dados do agente
 *  - Receber eventos reais da empresa (repassados do main process via IPC)
 *    e refletir no 3D — NUNCA gerar atividade sozinho (seção 26/38).
 *
 * IMPORTANTE: este arquivo não importa o EventBus do main process
 * diretamente (são processos Node separados, ver nota da entrega
 * anterior). Quem alimenta o SceneManager é o `renderer.js`, chamando
 * `sceneManager.handleCompanyEvent(event)` dentro do listener
 * `ipcRenderer.on('event', ...)` que já existe no protótipo atual.
 */

const THREE = require("three");
const { RoomFactory } = require("./RoomFactory");
const {
  createAgentAvatar,
  setAgentAvatarStatus,
  moveAgentAvatarTo,
  updateAgentAvatarMovement,
  getAgentAvatarInfo,
} = require("./AgentAvatar");
const { EVENT_TYPES } = require("../core/events/eventTypes");

const DEPARTMENT_GAP = 3; // espaço (unidades de mundo) entre salas de departamentos vizinhos

class SceneManager {
  /**
   * @param {HTMLElement} container - div onde o <canvas> do renderer vai entrar
   * @param {object} [options]
   * @param {RoomFactory} [options.roomFactory] - injeta uma instância customizada (ex: apontando pra userData)
   * @param {(agentInfo: {agentId: string, name: string, status: string}) => void} [options.onAgentSelected]
   */
  constructor(container, { roomFactory, onAgentSelected } = {}) {
    if (!container) {
      throw new Error("[SceneManager] um container (elemento DOM) é obrigatório.");
    }

    this.container = container;
    this.roomFactory = roomFactory || new RoomFactory();
    this.onAgentSelected = onAgentSelected || null;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this._clock = new THREE.Clock();
    this._animationId = null;

    /** @type {Map<string, THREE.Group>} departmentId -> sala já posicionada no mundo */
    this.roomGroups = new Map();
    /** @type {Map<string, {x:number, z:number}>} departmentId -> origem da sala no mundo */
    this.roomOrigins = new Map();
    /** @type {Map<string, THREE.Group>} agentId -> avatar */
    this.avatars = new Map();
    /** @type {Map<string, {departmentId: string, slotIndex: number}>} agentId -> slot ocupado */
    this.agentSlotIndex = new Map();
    /** @type {Map<string, Set<number>>} departmentId -> índices de slot ocupados */
    this.occupiedSlots = new Map();

    this._layoutCursorX = 0;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  // =========================================================
  // Ciclo de vida
  // =========================================================

  init() {
    const { clientWidth, clientHeight } = this.container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f172a);

    this.camera = new THREE.PerspectiveCamera(60, clientWidth / (clientHeight || 1), 0.1, 1000);
    this.camera.position.set(0, 14, 20);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(clientWidth, clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.container.innerHTML = "";
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0x404040, 2));
    const directional = new THREE.DirectionalLight(0xffffff, 1);
    directional.position.set(10, 20, 10);
    directional.castShadow = true;
    this.scene.add(directional);

    this.scene.add(new THREE.GridHelper(80, 80, 0x334155, 0x1e293b));

    window.addEventListener("resize", this._onResize);
    this.renderer.domElement.addEventListener("pointerdown", this._onPointerDown);

    this._animate();
  }

  _animate() {
    this._animationId = requestAnimationFrame(() => this._animate());
    const delta = this._clock.getDelta();

    for (const avatar of this.avatars.values()) {
      updateAgentAvatarMovement(avatar, delta);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / (clientHeight || 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  }

  _onPointerDown(event) {
    if (!this.onAgentSelected) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._pointer, this.camera);
    const intersects = this._raycaster.intersectObjects(Array.from(this.avatars.values()), true);
    if (intersects.length === 0) return;

    let obj = intersects[0].object;
    while (obj && !obj.userData?.agentId) obj = obj.parent;
    if (obj) this.onAgentSelected(getAgentAvatarInfo(obj));
  }

  dispose() {
    if (this._animationId) cancelAnimationFrame(this._animationId);
    if (typeof window !== "undefined") window.removeEventListener("resize", this._onResize);
    this.renderer?.domElement.removeEventListener("pointerdown", this._onPointerDown);

    for (const group of this.roomGroups.values()) this._disposeObject3D(group);
    for (const avatar of this.avatars.values()) this._disposeObject3D(avatar);

    this.renderer?.dispose();
  }

  _disposeObject3D(object) {
    object.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  // =========================================================
  // Departamentos / salas
  // =========================================================

  /**
   * Resincroniza TODAS as salas com a lista atual de departamentos —
   * usado no boot ou após um `company.state.synced`. Remove salas de
   * departamentos que não existem mais, adiciona/atualiza o resto.
   * @param {object[]} departments
   */
  syncDepartments(departments) {
    const incomingIds = new Set(departments.map((d) => d.id));
    for (const existingId of Array.from(this.roomGroups.keys())) {
      if (!incomingIds.has(existingId)) this.removeDepartmentRoom(existingId);
    }

    this._layoutCursorX = 0;
    departments.forEach((dept) => this.upsertDepartmentRoom(dept));
  }

  /**
   * Cria (ou reconstrói, se mudou) a sala de UM departamento e a
   * posiciona ao lado das já existentes.
   * @param {object} department
   */
  upsertDepartmentRoom(department) {
    if (this.roomGroups.has(department.id)) {
      this.removeDepartmentRoom(department.id, { keepDescriptor: true });
    }

    const roomGroup = this.roomFactory.getOrBuildRoom(department);
    const { width } = roomGroup.userData.footprint;

    const x = this._layoutCursorX + width / 2;
    this._layoutCursorX += width + DEPARTMENT_GAP;

    roomGroup.position.set(x, 0, 0);
    if (this.scene) this.scene.add(roomGroup);

    this.roomGroups.set(department.id, roomGroup);
    this.roomOrigins.set(department.id, { x, z: 0 });
    if (!this.occupiedSlots.has(department.id)) this.occupiedSlots.set(department.id, new Set());

    // Se agentes desse departamento já existiam (sala foi reconstruída
    // por mudança de tamanho/tipo/cor), reposiciona-os pros slots novos.
    this._repositionAvatarsForDepartment(department.id);

    return roomGroup;
  }

  /**
   * @param {string} departmentId
   * @param {object} [options]
   * @param {boolean} [options.keepDescriptor=false] - true ao reconstruir (não é uma remoção real)
   */
  removeDepartmentRoom(departmentId, { keepDescriptor = false } = {}) {
    const group = this.roomGroups.get(departmentId);
    if (group && this.scene) this.scene.remove(group);

    if (keepDescriptor) {
      this.roomFactory.invalidate(departmentId);
    } else {
      this.roomFactory.removeDepartment(departmentId);
      // Departamento deletado de verdade: remove os avatares que moravam nele.
      for (const [agentId, info] of Array.from(this.agentSlotIndex.entries())) {
        if (info.departmentId === departmentId) this.removeAgent(agentId);
      }
    }

    this.roomGroups.delete(departmentId);
    this.roomOrigins.delete(departmentId);
    this.occupiedSlots.delete(departmentId);
  }

  // =========================================================
  // Agentes
  // =========================================================

  /**
   * Cria (ou atualiza posição/status de) o avatar de um agente.
   * @param {object} agent
   * @param {string} agent.id
   * @param {string} [agent.name]
   * @param {string} agent.departmentId
   * @param {string} [agent.status='idle']
   */
  addOrUpdateAgent(agent) {
    const { id: agentId, name, departmentId, status = "idle" } = agent;

    if (!this.roomGroups.has(departmentId)) {
      console.warn(
        `[SceneManager] Departamento "${departmentId}" ainda não tem sala montada; ` +
          `agente "${agentId}" será posicionado assim que upsertDepartmentRoom for chamado pra ele.`
      );
      return null;
    }

    let avatar = this.avatars.get(agentId);
    const previousDept = this.agentSlotIndex.get(agentId)?.departmentId;
    const changedDepartment = previousDept && previousDept !== departmentId;

    if (!avatar) {
      avatar = createAgentAvatar({ agentId, name, status });
      if (this.scene) this.scene.add(avatar);
      this.avatars.set(agentId, avatar);
    } else {
      setAgentAvatarStatus(avatar, status);
      avatar.userData.name = name;
    }

    if (!previousDept || changedDepartment) {
      if (changedDepartment) this._releaseSlot(agentId);
      const worldPos = this._assignSlot(departmentId, agentId);
      if (worldPos) moveAgentAvatarTo(avatar, worldPos);
    }

    return avatar;
  }

  /** @param {string} agentId */
  removeAgent(agentId) {
    const avatar = this.avatars.get(agentId);
    if (avatar) {
      if (this.scene) this.scene.remove(avatar);
      this._disposeObject3D(avatar);
      this.avatars.delete(agentId);
    }
    this._releaseSlot(agentId);
  }

  /**
   * @param {string} agentId
   * @param {string} status - uma das chaves de STATUS_COLORS (AgentAvatar.js)
   */
  setAgentStatus(agentId, status) {
    const avatar = this.avatars.get(agentId);
    if (!avatar) return;
    setAgentAvatarStatus(avatar, status);
  }

  _assignSlot(departmentId, agentId) {
    const roomGroup = this.roomGroups.get(departmentId);
    const origin = this.roomOrigins.get(departmentId);
    const slots = roomGroup?.userData?.agentSlots || [];
    const occupied = this.occupiedSlots.get(departmentId) || new Set();

    let slotIndex = slots.findIndex((_, i) => !occupied.has(i));
    if (slotIndex === -1) {
      // Mais agentes do que estações de trabalho: empilha no último
      // slot em vez de quebrar — degrada graciosamente (seção 39).
      slotIndex = slots.length ? slots.length - 1 : 0;
      console.warn(
        `[SceneManager] Departamento "${departmentId}" tem mais agentes que estações de trabalho.`
      );
    }

    occupied.add(slotIndex);
    this.occupiedSlots.set(departmentId, occupied);
    this.agentSlotIndex.set(agentId, { departmentId, slotIndex });

    const localSlot = slots[slotIndex];
    if (!localSlot || !origin) return origin ? { x: origin.x, z: origin.z } : null;

    return { x: origin.x + localSlot.x, z: origin.z + localSlot.z };
  }

  _releaseSlot(agentId) {
    const info = this.agentSlotIndex.get(agentId);
    if (!info) return;
    const occupied = this.occupiedSlots.get(info.departmentId);
    if (occupied) occupied.delete(info.slotIndex);
    this.agentSlotIndex.delete(agentId);
  }

  _repositionAvatarsForDepartment(departmentId) {
    const origin = this.roomOrigins.get(departmentId);
    const roomGroup = this.roomGroups.get(departmentId);
    if (!origin || !roomGroup) return;

    const slots = roomGroup.userData.agentSlots || [];
    for (const [agentId, info] of this.agentSlotIndex.entries()) {
      if (info.departmentId !== departmentId) continue;
      const avatar = this.avatars.get(agentId);
      const localSlot = slots[info.slotIndex] || slots[slots.length - 1];
      if (avatar && localSlot) {
        moveAgentAvatarTo(avatar, { x: origin.x + localSlot.x, z: origin.z + localSlot.z });
      }
    }
  }

  // =========================================================
  // Sincronização a partir do estado real da empresa
  // =========================================================

  /**
   * Resync completo — chamado no boot ou em company.state.synced.
   * @param {object} state
   * @param {object[]} [state.departments]
   * @param {object[]} [state.agents]
   */
  syncFromCompanyState({ departments = [], agents = [] } = {}) {
    this.syncDepartments(departments);
    agents.forEach((agent) => this.addOrUpdateAgent(agent));
  }

  /**
   * Ponto de entrada único pra eventos reais da empresa, repassados
   * do main process via IPC (ver nota no topo do arquivo). Mapeia cada
   * tipo de evento pra uma atualização visual correspondente — e
   * ignora silenciosamente tipos sem efeito 3D direto (ex: task.*
   * detalhado, que aparece no chat/dashboard, não no mundo 3D).
   * @param {{type: string, payload: object}} event
   */
  handleCompanyEvent(event) {
    if (!event?.type) return;
    const { type, payload = {} } = event;

    switch (type) {
      case EVENT_TYPES.AGENT_CREATED:
      case EVENT_TYPES.AGENT_UPDATED:
      case EVENT_TYPES.AGENT_DEPARTMENT_CHANGED:
        if (payload.agent) this.addOrUpdateAgent(payload.agent);
        break;

      case EVENT_TYPES.AGENT_DELETED:
        if (payload.agentId) this.removeAgent(payload.agentId);
        break;

      case EVENT_TYPES.AGENT_WORKING:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "working");
        break;

      case EVENT_TYPES.AGENT_IDLE:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "idle");
        break;

      case EVENT_TYPES.AGENT_BLOCKED:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "blocked");
        break;

      case EVENT_TYPES.AGENT_ERROR:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "error");
        break;

      case EVENT_TYPES.AGENT_MEETING_STARTED:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "meeting");
        break;

      case EVENT_TYPES.AGENT_MEETING_ENDED:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "idle");
        break;

      case EVENT_TYPES.AGENT_MESSAGE_SENT:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "communicating");
        break;

      case EVENT_TYPES.AGENT_TASK_COMPLETED:
        if (payload.agentId) this.setAgentStatus(payload.agentId, "completed");
        break;

      case EVENT_TYPES.DEPARTMENT_CREATED:
      case EVENT_TYPES.DEPARTMENT_UPDATED:
        if (payload.department) this.upsertDepartmentRoom(payload.department);
        break;

      case EVENT_TYPES.DEPARTMENT_DELETED:
        if (payload.departmentId) this.removeDepartmentRoom(payload.departmentId);
        break;

      default:
        // Outros eventos (task.*, project.*, runtime.*) não têm efeito
        // 3D direto ainda — ignorar aqui é intencional, não é bug.
        break;
    }
  }
}

module.exports = { SceneManager };