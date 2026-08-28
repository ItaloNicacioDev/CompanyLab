/**
 * serverRack.js
 *
 * Peça reutilizável: rack de servidores. Usada em salas de IT/Dev e
 * Database (seção 22 do spec).
 *
 * Os LEDs (`ledMeshes` em userData) começam apagados por padrão.
 * Quem instancia é responsável por acendê-los via `setServerRackActivity()`
 * refletindo atividade real (ex: runtime rodando, task em andamento) —
 * nunca piscar aleatoriamente aqui dentro (seção 26 do spec).
 */

const THREE = require("three");

const RACK_WIDTH = 0.5;
const RACK_HEIGHT = 1.6;
const RACK_DEPTH = 0.6;
const UNITS = 6; // quantas "gavetas" o rack tem

/**
 * @param {object} [options]
 * @param {number} [options.frameColor=0x1e1e1e]
 * @param {number} [options.ledColor=0x22c55e] - cor do LED quando "ativo"
 * @returns {THREE.Group}
 */
function createServerRack({ frameColor = 0x1e1e1e, ledColor = 0x22c55e } = {}) {
  const rack = new THREE.Group();
  rack.name = "prop:serverRack";

  // Corpo do rack
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(RACK_WIDTH, RACK_HEIGHT, RACK_DEPTH),
    new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.5, metalness: 0.3 })
  );
  body.position.y = RACK_HEIGHT / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  rack.add(body);

  // Unidades (gavetas) + 1 LED cada, na face frontal
  const unitHeight = (RACK_HEIGHT - 0.1) / UNITS;
  const ledMeshes = [];

  for (let i = 0; i < UNITS; i++) {
    const y = 0.05 + unitHeight * i + unitHeight / 2;

    const unitFace = new THREE.Mesh(
      new THREE.BoxGeometry(RACK_WIDTH - 0.04, unitHeight - 0.01, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 })
    );
    unitFace.position.set(0, y, RACK_DEPTH / 2 + 0.005);
    rack.add(unitFace);

    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        emissive: 0x000000,
        emissiveIntensity: 0,
      })
    );
    led.position.set(RACK_WIDTH / 2 - 0.06, y, RACK_DEPTH / 2 + 0.012);
    led.userData = { ledColor };
    rack.add(led);
    ledMeshes.push(led);
  }

  rack.userData = {
    propType: "serverRack",
    footprint: { width: RACK_WIDTH, depth: RACK_DEPTH },
    ledMeshes,
  };

  return rack;
}

/**
 * Acende/apaga uma quantidade de LEDs do rack, refletindo carga real
 * (ex: número de runtimes ativos, tasks em execução no departamento).
 * @param {THREE.Group} rackGroup - retorno de createServerRack()
 * @param {number} activeCount - quantos LEDs devem estar acesos (0..UNITS)
 */
function setServerRackActivity(rackGroup, activeCount) {
  const leds = rackGroup?.userData?.ledMeshes;
  if (!leds) return;
  const clamped = Math.max(0, Math.min(activeCount, leds.length));

  leds.forEach((led, index) => {
    const isOn = index < clamped;
    const color = isOn ? led.userData.ledColor : 0x1a1a1a;
    led.material.color.set(color);
    led.material.emissive.set(isOn ? led.userData.ledColor : 0x000000);
    led.material.emissiveIntensity = isOn ? 1 : 0;
  });
}

module.exports = { createServerRack, setServerRackActivity, SERVER_RACK_UNITS: UNITS };