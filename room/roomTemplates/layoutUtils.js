/**
 * layoutUtils.js
 *
 * Funções compartilhadas entre TODOS os templates de sala
 * (development, marketing, finance, generic...). Evita reescrever
 * "monta o chão", "monta a borda da sala" e "distribui N estações
 * de trabalho num grid" em cada arquivo de template.
 */

const THREE = require("three");

/**
 * Cria o chão + uma borda fina colorida no perímetro (efeito "zona
 * demarcada", tipo tapete/holograma). NÃO cria uma caixa sólida
 * cobrindo a sala — isso esconderia os agentes lá dentro, que é
 * exatamente o problema do protótipo antigo em createRoom3D().
 *
 * @param {number} width
 * @param {number} depth
 * @param {object} [options]
 * @param {number} [options.floorColor=0x1e293b]
 * @param {number} [options.accentColor=0x3b82f6] - cor de identidade do departamento
 * @returns {THREE.Group}
 */
function createRoomBase(width, depth, { floorColor = 0x1e293b, accentColor = 0x3b82f6 } = {}) {
  const base = new THREE.Group();
  base.name = "roomBase";

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  base.add(floor);

  // Borda: 4 barras finas formando o retângulo do perímetro, com leve
  // emissão na cor de identidade do departamento.
  const borderMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.4,
    roughness: 0.3,
  });
  const borderThickness = 0.05;
  const borderHeight = 0.03;

  const edges = [
    { w: width, d: borderThickness, x: 0, z: -depth / 2 }, // fundo
    { w: width, d: borderThickness, x: 0, z: depth / 2 }, // frente
    { w: borderThickness, d: depth, x: -width / 2, z: 0 }, // esquerda
    { w: borderThickness, d: depth, x: width / 2, z: 0 }, // direita
  ];
  edges.forEach(({ w, d, x, z }) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, borderHeight, d), borderMat);
    bar.position.set(x, borderHeight / 2, z);
    base.add(bar);
  });

  return base;
}

/**
 * Cria painéis baixos e semi-transparentes ao fundo e nas laterais da
 * sala (deixa a frente aberta pra câmera enxergar dentro). É decoração
 * de "divisória de escritório", não uma caixa fechada.
 *
 * @param {number} width
 * @param {number} depth
 * @param {object} [options]
 * @param {number} [options.height=0.9]
 * @param {number} [options.color=0x334155]
 * @param {number} [options.opacity=0.35]
 */
function createPerimeterWalls(width, depth, { height = 0.9, color = 0x334155, opacity = 0.35 } = {}) {
  const walls = new THREE.Group();
  walls.name = "roomWalls";

  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  backWall.position.set(0, height / 2, -depth / 2);
  walls.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), mat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-width / 2, height / 2, 0);
  walls.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(depth, height), mat);
  rightWall.rotation.y = Math.PI / 2;
  rightWall.position.set(width / 2, height / 2, 0);
  walls.add(rightWall);

  // Frente propositalmente aberta.
  return walls;
}

/**
 * Distribui N posições em um grid centrado na origem — usado pra
 * posicionar estações de trabalho (mesa+monitor) sem sobrepor.
 *
 * @param {number} count - quantos slots gerar
 * @param {object} itemFootprint - {width, depth} de UM item
 * @param {number} [gap=0.5] - espaço extra entre itens
 * @returns {{x: number, z: number}[]}
 */
function placeInGrid(count, itemFootprint, gap = 0.5) {
  if (count <= 0) return [];

  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const stepX = itemFootprint.width + gap;
  const stepZ = itemFootprint.depth + gap;

  const positions = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * stepX;
    const z = (row - (rows - 1) / 2) * stepZ;
    positions.push({ x, z });
  }
  return positions;
}

/**
 * Calcula um tamanho de sala razoável pra caber N estações de trabalho
 * com uma margem de circulação em volta. Usado pelos templates pra
 * dimensionar a sala de acordo com employeeCount real, em vez de um
 * tamanho fixo que fica apertado com muitos agentes ou vazio com poucos.
 *
 * @param {number} count
 * @param {object} itemFootprint - {width, depth}
 * @param {number} [margin=1.5] - espaço de circulação nas bordas
 */
function computeRoomSize(count, itemFootprint, margin = 1.5) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(count, 1))));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols));
  const width = cols * (itemFootprint.width + 0.5) + margin * 2;
  const depth = rows * (itemFootprint.depth + 0.5) + margin * 2;
  return {
    width: Math.max(width, 3), // nunca menor que uma sala mínima
    depth: Math.max(depth, 3),
  };
}

module.exports = {
  createRoomBase,
  createPerimeterWalls,
  placeInGrid,
  computeRoomSize,
};