/**
 * desk.js
 *
 * Peça reutilizável: mesa de escritório. Usada por vários templates de
 * sala (development, marketing, finance...) — não pertence a nenhum
 * departamento específico.
 *
 * Convenção seguida por TODO prop deste diretório:
 *   - Exporta uma função `createX(options) -> THREE.Group`.
 *   - O Group tem `userData.propType` (identifica o que é, útil ao
 *     clicar num objeto na cena) e `userData.footprint` (largura x
 *     profundidade em unidades de mundo, pra RoomFactory/generic.js
 *     conseguirem posicionar props sem se sobrepor, sem precisar
 *     calcular bounding box toda vez).
 *   - A peça é modelada com a base em y = 0 (encosta no chão), pra
 *     quem for posicionar só precisar setar x/z.
 */

const THREE = require("three");

/**
 * @param {object} [options]
 * @param {number} [options.legColor=0x3a3a3a] - cor das pernas/estrutura
 * @param {number} [options.topColor=0x8a5a35] - cor do tampo
 * @returns {THREE.Group}
 */
function createDesk({ legColor = 0x3a3a3a, topColor = 0x8a5a35 } = {}) {
  const desk = new THREE.Group();
  desk.name = "prop:desk";

  const DESK_WIDTH = 1.4;
  const DESK_DEPTH = 0.7;
  const DESK_HEIGHT = 0.75;

  // Tampo
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(DESK_WIDTH, 0.06, DESK_DEPTH),
    new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.6 })
  );
  top.position.y = DESK_HEIGHT;
  top.castShadow = true;
  top.receiveShadow = true;
  desk.add(top);

  // 4 pernas
  const legGeo = new THREE.BoxGeometry(0.06, DESK_HEIGHT, 0.06);
  const legMat = new THREE.MeshStandardMaterial({ color: legColor, roughness: 0.7 });
  const legOffsets = [
    [-DESK_WIDTH / 2 + 0.08, DESK_HEIGHT / 2, -DESK_DEPTH / 2 + 0.08],
    [DESK_WIDTH / 2 - 0.08, DESK_HEIGHT / 2, -DESK_DEPTH / 2 + 0.08],
    [-DESK_WIDTH / 2 + 0.08, DESK_HEIGHT / 2, DESK_DEPTH / 2 - 0.08],
    [DESK_WIDTH / 2 - 0.08, DESK_HEIGHT / 2, DESK_DEPTH / 2 - 0.08],
  ];
  legOffsets.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, y, z);
    leg.castShadow = true;
    desk.add(leg);
  });

  desk.userData = {
    propType: "desk",
    footprint: { width: DESK_WIDTH, depth: DESK_DEPTH },
    surfaceHeight: DESK_HEIGHT, // altura útil pra encaixar monitor/plant em cima
  };

  return desk;
}

module.exports = { createDesk };