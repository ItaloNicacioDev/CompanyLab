/**
 * development.js
 *
 * Template de sala para departamentos de TI / Desenvolvimento
 * (seção 22 do spec): mesas com monitores + rack de servidores.
 *
 * Interface comum a TODO template (development, marketing, finance,
 * generic): exporta `build(options) -> THREE.Group`, e o Group
 * sempre carrega em userData:
 *   - roomType: identifica o template usado
 *   - footprint: {width, depth} da sala inteira
 *   - agentSlots: posições [{x,z}] onde um AgentAvatar pode "morar" —
 *     usado depois pelo SceneManager pra posicionar os agentes reais
 *     do departamento, um por estação de trabalho.
 */

const THREE = require("three");
const { createDesk } = require("../props/desk");
const { createMonitor } = require("../props/monitor");
const { createServerRack } = require("../props/serverRack");
const { createPlant } = require("../props/plant");
const { createRoomBase, createPerimeterWalls, placeInGrid, computeRoomSize } = require("./layoutUtils");

const ACCENT_COLOR = 0x3b82f6; // azul — identidade visual de Dev/TI
const FLOOR_COLOR = 0x1a2332;

const DESK_FOOTPRINT = { width: 1.4, depth: 0.7 };

/**
 * @param {object} [options]
 * @param {number} [options.employeeCount=3] - quantas estações de trabalho gerar
 * @param {number} [options.accentColor] - sobrescreve a cor de identidade (ex: cor custom do dept)
 * @returns {THREE.Group}
 */
function build({ employeeCount = 3, accentColor = ACCENT_COLOR } = {}) {
  const room = new THREE.Group();
  room.name = "room:development";

  const { width, depth } = computeRoomSize(employeeCount, DESK_FOOTPRINT);

  room.add(createRoomBase(width, depth, { floorColor: FLOOR_COLOR, accentColor }));
  room.add(createPerimeterWalls(width, depth, { color: 0x1e3a5f }));

  // Estações de trabalho: mesa + monitor, uma por posição do grid.
  const workstationPositions = placeInGrid(employeeCount, DESK_FOOTPRINT, 0.6);
  const agentSlots = [];

  workstationPositions.forEach(({ x, z }) => {
    const desk = createDesk({ topColor: 0x2d3748, legColor: 0x1a1a2e });
    desk.position.set(x, 0, z);
    room.add(desk);

    const monitor = createMonitor({ active: false, screenColor: accentColor });
    monitor.position.set(x, desk.userData.surfaceHeight, z - 0.15);
    room.add(monitor);

    // Slot do agente: um pouco à frente da mesa, olhando pra ela.
    agentSlots.push({ x, z: z + 0.5, facing: { x, z } });
  });

  // Rack de servidores encostado na parede de fundo.
  const rack = createServerRack({ ledColor: 0x22c55e });
  rack.position.set(width / 2 - 0.5, 0, -depth / 2 + 0.4);
  room.add(rack);

  // Plantas nos cantos livres pra não ficar estéril.
  const plant1 = createPlant();
  plant1.position.set(-width / 2 + 0.3, 0, -depth / 2 + 0.3);
  room.add(plant1);

  const plant2 = createPlant();
  plant2.position.set(-width / 2 + 0.3, 0, depth / 2 - 0.3);
  room.add(plant2);

  room.userData = {
    roomType: "development",
    footprint: { width, depth },
    agentSlots,
    serverRack: rack, // referência direta pro SceneManager acender LEDs com atividade real
  };

  return room;
}

module.exports = { build, ROOM_TYPE: "development" };