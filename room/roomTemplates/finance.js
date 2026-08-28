/**
 * finance.js
 *
 * Template de sala para departamentos Financeiros / Contabilidade
 * (seção 22 do spec): escritório corporativo, mesas mais espaçadas
 * (menos "open space" que dev/marketing) e monitores de dashboard.
 */

const THREE = require("three");
const { createDesk } = require("../props/desk");
const { createMonitor } = require("../props/monitor");
const { createPlant } = require("../props/plant");
const { createRoomBase, createPerimeterWalls, placeInGrid, computeRoomSize } = require("./layoutUtils");

const ACCENT_COLOR = 0x10b981; // verde-esmeralda — identidade visual de Finanças
const FLOOR_COLOR = 0x18251f;

const DESK_FOOTPRINT = { width: 1.4, depth: 0.7 };
const DESK_GAP = 0.9; // mais espaçado que dev/marketing — visual mais "sóbrio"

/**
 * @param {object} [options]
 * @param {number} [options.employeeCount=3]
 * @param {number} [options.accentColor]
 * @returns {THREE.Group}
 */
function build({ employeeCount = 3, accentColor = ACCENT_COLOR } = {}) {
  const room = new THREE.Group();
  room.name = "room:finance";

  const { width, depth } = computeRoomSize(employeeCount, DESK_FOOTPRINT, 1.8);

  room.add(createRoomBase(width, depth, { floorColor: FLOOR_COLOR, accentColor }));
  room.add(createPerimeterWalls(width, depth, { color: 0x1f3d31 }));

  const workstationPositions = placeInGrid(employeeCount, DESK_FOOTPRINT, DESK_GAP);
  const agentSlots = [];

  workstationPositions.forEach(({ x, z }) => {
    const desk = createDesk({ topColor: 0x3f3f3f, legColor: 0x1a1a1a });
    desk.position.set(x, 0, z);
    room.add(desk);

    // Cada estação financeira tem 2 monitores lado a lado (dashboards).
    [-0.12, 0.12].forEach((offsetX) => {
      const monitor = createMonitor({ active: false, screenColor: accentColor });
      monitor.position.set(x + offsetX, desk.userData.surfaceHeight, z - 0.15);
      room.add(monitor);
    });

    agentSlots.push({ x, z: z + 0.5, facing: { x, z } });
  });

  // Armário/estante decorativa simples encostada na parede.
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.1, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 })
  );
  cabinet.position.set(-width / 2 + 0.55, 0.55, -depth / 2 + 0.3);
  cabinet.castShadow = true;
  room.add(cabinet);

  const plant = createPlant();
  plant.position.set(width / 2 - 0.3, 0, -depth / 2 + 0.3);
  room.add(plant);

  room.userData = {
    roomType: "finance",
    footprint: { width, depth },
    agentSlots,
  };

  return room;
}

module.exports = { build, ROOM_TYPE: "finance" };