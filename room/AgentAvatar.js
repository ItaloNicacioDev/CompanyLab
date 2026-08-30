/**
 * AgentAvatar.js
 *
 * Avatar 3D de um agente, sempre refletindo estado REAL (seção 23 e 26
 * do spec — nunca inventar status ou animação sem um evento real por
 * trás). Quem decide a cor/estado é sempre quem chama
 * setAgentAvatarStatus() com base num evento do EventBus repassado
 * pelo main process — este arquivo só sabe desenhar e mover.
 */

const THREE = require("three");

/** Cores por status — cobre os estados listados na seção 23 do spec. */
const STATUS_COLORS = Object.freeze({
  idle: 0x64748b, // cinza — parado
  working: 0x22c55e, // verde — trabalhando
  communicating: 0x3b82f6, // azul — enviando/recebendo mensagem
  meeting: 0x8b5cf6, // roxo — em reunião
  waiting: 0xf59e0b, // âmbar — esperando algo
  blocked: 0xef4444, // vermelho — bloqueado
  error: 0xdc2626, // vermelho escuro — erro
  completed: 0x06b6d4, // ciano — acabou de concluir uma tarefa
});

const DEFAULT_STATUS = "idle";
const MOVE_SPEED = 2.2; // unidades de mundo por segundo

/**
 * @param {object} options
 * @param {string} options.agentId - obrigatório
 * @param {string} [options.name]
 * @param {string} [options.status='idle']
 * @param {number} [options.bodyColor=0x94a3b8]
 * @param {boolean} [options.showLabel=true] - só funciona em ambiente com `document` (renderer/browser)
 * @returns {THREE.Group}
 */
function createAgentAvatar({ agentId, name, status = DEFAULT_STATUS, bodyColor = 0x94a3b8, showLabel = true } = {}) {
  if (!agentId) {
    throw new Error("[AgentAvatar] agentId é obrigatório para criar um avatar.");
  }

  const avatar = new THREE.Group();
  avatar.name = `avatar:${agentId}`;

  // Corpo: THREE r128 não tem CapsuleGeometry (só a partir do r142), então
  // o "boneco" é cilindro (torso) + esfera (cabeça) — simples e leve, dá
  // pra ter 100 agentes na tela sem pesar (seção 29 do spec).
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.16, 0.55, 12),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6 })
  );
  body.position.y = 0.3;
  body.castShadow = true;
  avatar.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf1c27d, roughness: 0.6 })
  );
  head.position.y = 0.7;
  head.castShadow = true;
  avatar.add(head);

  // Anel de status no chão, sob os pés — é o principal indicador visual
  // de "o que esse agente está fazendo agora", visível mesmo de longe.
  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS[DEFAULT_STATUS];
  const statusRing = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.26, 24),
    new THREE.MeshStandardMaterial({
      color: statusColor,
      emissive: statusColor,
      emissiveIntensity: 0.7,
      side: THREE.DoubleSide,
    })
  );
  statusRing.rotation.x = -Math.PI / 2;
  statusRing.position.y = 0.01;
  avatar.add(statusRing);

  // Etiqueta com o nome, flutuando acima da cabeça. Usa canvas 2D, então
  // só funciona onde `document` existe (renderer do Electron / browser).
  // Em Node puro (ex: testes automatizados), o avatar é criado normalmente
  // só sem a etiqueta — degrada graciosamente em vez de quebrar.
  let nameSprite = null;
  if (showLabel && name && typeof document !== "undefined") {
    nameSprite = createNameSprite(name);
    nameSprite.position.y = 1.0;
    avatar.add(nameSprite);
  }

  avatar.userData = {
    agentId,
    name,
    status,
    statusRing,
    nameSprite,
    targetPosition: null, // {x, z} — setado por moveAgentAvatarTo, consumido por updateAgentAvatarMovement
  };

  return avatar;
}

/** @param {string} text @returns {THREE.Sprite} */
function createNameSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "28px sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.9, 0.22, 1);
  return sprite;
}

/**
 * Atualiza a cor do anel de status, refletindo um evento real recebido
 * (ex: agent.task.started -> 'working').
 * @param {THREE.Group} avatarGroup
 * @param {string} status - uma das chaves de STATUS_COLORS
 */
function setAgentAvatarStatus(avatarGroup, status) {
  const ring = avatarGroup?.userData?.statusRing;
  if (!ring) return;
  const color = STATUS_COLORS[status] ?? STATUS_COLORS[DEFAULT_STATUS];
  ring.material.color.set(color);
  ring.material.emissive.set(color);
  avatarGroup.userData.status = status;
}

/**
 * Define um destino de movimento (posição no mundo). Não move de
 * imediato — o deslocamento suave acontece via updateAgentAvatarMovement,
 * chamado a cada frame pelo SceneManager.
 * @param {THREE.Group} avatarGroup
 * @param {{x: number, z: number}} target
 */
function moveAgentAvatarTo(avatarGroup, target) {
  avatarGroup.userData.targetPosition = { x: target.x, z: target.z };
}

/**
 * Avança o avatar em direção ao seu targetPosition, se houver um.
 * Chamada uma vez por frame, pra cada avatar, dentro do loop de
 * animação do SceneManager.
 * @param {THREE.Group} avatarGroup
 * @param {number} deltaSeconds - tempo desde o frame anterior
 * @returns {boolean} true se ainda está se movendo, false se chegou/parado
 */
function updateAgentAvatarMovement(avatarGroup, deltaSeconds) {
  const target = avatarGroup.userData.targetPosition;
  if (!target) return false;

  const dx = target.x - avatarGroup.position.x;
  const dz = target.z - avatarGroup.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.02) {
    avatarGroup.position.x = target.x;
    avatarGroup.position.z = target.z;
    avatarGroup.userData.targetPosition = null;
    return false;
  }

  const step = Math.min(dist, MOVE_SPEED * deltaSeconds);
  avatarGroup.position.x += (dx / dist) * step;
  avatarGroup.position.z += (dz / dist) * step;
  avatarGroup.rotation.y = Math.atan2(dx, dz); // vira na direção do movimento

  return true;
}

/** @param {THREE.Group} avatarGroup @returns {{agentId: string, name: string, status: string}} */
function getAgentAvatarInfo(avatarGroup) {
  return {
    agentId: avatarGroup.userData.agentId,
    name: avatarGroup.userData.name,
    status: avatarGroup.userData.status,
  };
}

module.exports = {
  createAgentAvatar,
  setAgentAvatarStatus,
  moveAgentAvatarTo,
  updateAgentAvatarMovement,
  getAgentAvatarInfo,
  STATUS_COLORS,
};