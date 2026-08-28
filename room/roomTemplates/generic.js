/**
 * generic.js
 *
 * Template PROCEDURAL de fallback (seção 22 do spec: "Custom
 * departments must also receive appropriate environments" — nunca uma
 * caixa genérica sem identidade).
 *
 * Usado quando o usuário cria um departamento customizado que não bate
 * com nenhum template fixo (development/marketing/finance). Em vez de
 * desenhar uma sala fixa, este arquivo COMPÕE a sala a partir das tags
 * de função que o usuário escolheu na criação do departamento
 * (ex: "Pesquisa", "Físico/Industrial"), reaproveitando as props que
 * já existem — sempre entra pelo menos mesas+monitores (toda sala tem
 * gente trabalhando), e as props extras variam por tag.
 */

const THREE = require("three");
const { createDesk } = require("../props/desk");
const { createMonitor } = require("../props/monitor");
const { createPlant } = require("../props/plant");
const { createServerRack } = require("../props/serverRack");
const { createCamera } = require("../props/camera");
const { createLabBench } = require("../props/lab-bench");
const { createRoomBase, createPerimeterWalls, placeInGrid, computeRoomSize } = require("./layoutUtils");

const DEFAULT_ACCENT_COLOR = 0x8b5cf6; // roxo — cor neutra pra departamentos sem template fixo
const FLOOR_COLOR = 0x1f1a2e;
const DESK_FOOTPRINT = { width: 1.4, depth: 0.7 };

/**
 * Cada tag de função aponta pra uma prop extra a colocar na sala.
 * Isso é o que faz duas salas customizadas com tags diferentes
 * parecerem realmente diferentes, mesmo sem template dedicado.
 */
const TAG_EXTRA_PROPS = {
  Tecnologia: () => createServerRack(),
  Dados: () => createServerRack({ ledColor: 0x38bdf8 }),
  Pesquisa: () => createLabBench(),
  "Físico/Industrial": () => createLabBench({ benchColor: 0x9ca3af, liquidColor: 0xf59e0b }),
  Criativo: () => createCamera(),
  Comunicação: () => createCamera({ bodyColor: 0x2a2a2a }),
};

/**
 * @param {object} [options]
 * @param {number} [options.employeeCount=2]
 * @param {number} [options.accentColor=DEFAULT_ACCENT_COLOR] - cor escolhida pelo usuário no color picker
 * @param {string[]} [options.tags=[]] - tags de função escolhidas na criação do departamento
 * @returns {THREE.Group}
 */
function build({ employeeCount = 2, accentColor = DEFAULT_ACCENT_COLOR, tags = [] } = {}) {
  const room = new THREE.Group();
  room.name = "room:generic";

  const { width, depth } = computeRoomSize(employeeCount, DESK_FOOTPRINT);

  room.add(createRoomBase(width, depth, { floorColor: FLOOR_COLOR, accentColor }));
  room.add(createPerimeterWalls(width, depth, { color: 0x2e2545 }));

  // Toda sala, custom ou não, tem gente de fato trabalhando ali.
  const workstationPositions = placeInGrid(employeeCount, DESK_FOOTPRINT, 0.6);
  const agentSlots = [];

  workstationPositions.forEach(({ x, z }) => {
    const desk = createDesk();
    desk.position.set(x, 0, z);
    room.add(desk);

    const monitor = createMonitor({ active: false, screenColor: accentColor });
    monitor.position.set(x, desk.userData.surfaceHeight, z - 0.15);
    room.add(monitor);

    agentSlots.push({ x, z: z + 0.5, facing: { x, z } });
  });

  // Props extras de acordo com as tags escolhidas pelo usuário —
  // no máximo 1 por tag reconhecida, encostadas na parede de fundo,
  // distribuídas lado a lado.
  const recognizedTags = tags.filter((tag) => TAG_EXTRA_PROPS[tag]);
  const extraStartX = -((recognizedTags.length - 1) * 0.9) / 2;

  recognizedTags.forEach((tag, index) => {
    const prop = TAG_EXTRA_PROPS[tag]();
    prop.position.set(extraStartX + index * 0.9, 0, -depth / 2 + 0.4);
    room.add(prop);
  });

  // Se nenhuma tag reconhecida foi escolhida, a sala ainda não fica
  // "pelada" — pelo menos uma planta pra não parecer sala vazia sem
  // identidade nenhuma.
  if (recognizedTags.length === 0) {
    const plant = createPlant();
    plant.position.set(0, 0, -depth / 2 + 0.3);
    room.add(plant);
  }

  room.userData = {
    roomType: "generic",
    footprint: { width, depth },
    agentSlots,
    appliedTags: recognizedTags,
  };

  return room;
}

module.exports = { build, ROOM_TYPE: "generic", TAG_EXTRA_PROPS };