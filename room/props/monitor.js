/**
 * monitor.js
 *
 * Peça reutilizável: monitor de computador sobre uma base. A tela usa
 * material emissivo pra parecer "ligada".
 *
 * IMPORTANTE (seção 26/38 do spec — No Fake Activity): o parâmetro
 * `active` deve ser setado por quem monta a cena com base em estado
 * REAL do agente (ex: agent.status === 'working'), nunca alternado
 * aleatoriamente aqui dentro. Este arquivo só sabe desenhar; quem
 * decide o estado é o SceneManager/AgentAvatar, lendo o EventBus.
 */

const THREE = require("three");

/**
 * @param {object} [options]
 * @param {boolean} [options.active=false] - se true, tela acesa (emissiva)
 * @param {number} [options.screenColor=0x4da6ff] - cor da tela quando ativa
 * @param {number} [options.frameColor=0x1a1a1a] - cor da moldura/base
 * @returns {THREE.Group}
 */
function createMonitor({ active = false, screenColor = 0x4da6ff, frameColor = 0x1a1a1a } = {}) {
  const monitor = new THREE.Group();
  monitor.name = "prop:monitor";

  const MONITOR_WIDTH = 0.4;
  const MONITOR_HEIGHT = 0.26;
  const BASE_HEIGHT = 0.03;
  const STAND_HEIGHT = 0.12;

  // Base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, BASE_HEIGHT, 16),
    new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.5 })
  );
  base.position.y = BASE_HEIGHT / 2;
  monitor.add(base);

  // Haste
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, STAND_HEIGHT, 0.03),
    new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.5 })
  );
  stand.position.y = BASE_HEIGHT + STAND_HEIGHT / 2;
  monitor.add(stand);

  // Moldura
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(MONITOR_WIDTH, MONITOR_HEIGHT, 0.02),
    new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.4 })
  );
  frame.position.y = BASE_HEIGHT + STAND_HEIGHT + MONITOR_HEIGHT / 2;
  frame.castShadow = true;
  monitor.add(frame);

  // Tela
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(MONITOR_WIDTH - 0.03, MONITOR_HEIGHT - 0.03),
    new THREE.MeshStandardMaterial({
      color: active ? screenColor : 0x0a0a0a,
      emissive: active ? screenColor : 0x000000,
      emissiveIntensity: active ? 0.6 : 0,
      roughness: 0.3,
    })
  );
  screen.position.set(0, frame.position.y, 0.011);
  monitor.add(screen);

  monitor.userData = {
    propType: "monitor",
    footprint: { width: MONITOR_WIDTH, depth: 0.12 },
    // Guarda referência direta pro mesh da tela, pra quem tem a
    // instância poder ligar/desligar depois sem precisar recriar
    // o prop inteiro (ex: setMonitorActive(monitorGroup, true)).
    screenMesh: screen,
  };

  return monitor;
}

/**
 * Atualiza a tela de um monitor já criado, refletindo mudança real de
 * estado (ex: agente ficou idle). Evita recriar geometria à toa.
 * @param {THREE.Group} monitorGroup - retorno de createMonitor()
 * @param {boolean} active
 * @param {number} [screenColor=0x4da6ff]
 */
function setMonitorActive(monitorGroup, active, screenColor = 0x4da6ff) {
  const screen = monitorGroup?.userData?.screenMesh;
  if (!screen) return;
  screen.material.color.set(active ? screenColor : 0x0a0a0a);
  screen.material.emissive.set(active ? screenColor : 0x000000);
  screen.material.emissiveIntensity = active ? 0.6 : 0;
}

module.exports = { createMonitor, setMonitorActive };