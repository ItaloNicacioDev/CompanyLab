/**
 * marketing.js
 *
 * Template de sala para departamentos de Marketing / Criativo
 * (seção 22 do spec): mesas com monitores voltados pra um "mural"
 * de apresentação, em vez de rack de servidores.
 */

const THREE = require("three");
const { createDesk } = require("../props/desk");
const { createMonitor } = require("../props/monitor");
const { createPlant } = require("../props/plant");
const { createRoomBase, createPerimeterWalls, placeInGrid, computeRoomSize } = require("./layoutUtils");

const ACCENT_COLOR = 0xf59e0b; // âmbar — identidade visual de Marketing/Criativo
const FLOOR_COLOR = 0x2a2118;

const DESK_FOOTPRINT = { width: 1.4, depth: 0.7 };

/**
 * @param {object} [options]
 * @param {number} [options.employeeCount=3]
 * @param {number} [options.accentColor]
 * @returns {THREE.Group}
 */
function build({ employeeCount = 3, accentColor = ACCENT_COLOR } = {}) {
  const room = new THREE.Group();
  room.name = "room:marketing";

  const { width, depth } = computeRoomSize(employeeCount, DESK_FOOTPRINT);

  room.add(createRoomBase(width, depth, { floorColor: FLOOR_COLOR, accentColor }));
  room.add(createPerimeterWalls(width, depth, { color: 0x5c3d1a }));

  // Mural de apresentação na parede de fundo — painel grande emissivo,
  // representando telas de campanha/branding.
  const presentationScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(width * 0.6, 3), 1.2),
    new THREE.MeshStandardMaterial({
      color: 0x1a1410,
      emissive: accentColor,
      emissiveIntensity: 0.15,
      roughness: 0.4,
    })
  );
  presentationScreen.position.set(0, 1, -depth / 2 + 0.02);
  room.add(presentationScreen);

  // Estações de trabalho voltadas pro mural.
  const workstationPositions = placeInGrid(employeeCount, DESK_FOOTPRINT, 0.7);
  const agentSlots = [];

  workstationPositions.forEach(({ x, z }) => {
    const desk = createDesk({ topColor: 0xb45309, legColor: 0x3a2410 });
    desk.position.set(x, 0, z);
    room.add(desk);

    const monitor = createMonitor({ active: false, screenColor: accentColor });
    monitor.position.set(x, desk.userData.surfaceHeight, z - 0.15);
    room.add(monitor);

    agentSlots.push({ x, z: z + 0.5, facing: { x, z } });
  });

  // Plantas — ambiente criativo pede mais verde que a sala de dev.
  [-1, 1].forEach((side) => {
    const plant = createPlant({ leafClusters: 6 });
    plant.position.set((width / 2 - 0.3) * side, 0, depth / 2 - 0.3);
    room.add(plant);
  });

  room.userData = {
    roomType: "marketing",
    footprint: { width, depth },
    agentSlots,
    presentationScreen,
  };

  return room;
}

module.exports = { build, ROOM_TYPE: "marketing" };