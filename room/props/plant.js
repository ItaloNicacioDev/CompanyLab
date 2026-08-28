/**
 * plant.js
 *
 * Peça reutilizável: planta decorativa em vaso. Usada em qualquer sala
 * pra dar vida ao ambiente — não tem relação com nenhum departamento
 * específico, então serve como "preenchimento" no generic.js.
 */

const THREE = require("three");

/**
 * @param {object} [options]
 * @param {number} [options.potColor=0x7a4a2f] - cor do vaso
 * @param {number} [options.leafColor=0x3a7d44] - cor das folhas
 * @param {number} [options.leafClusters=5] - quantas "folhagens" gerar
 * @returns {THREE.Group}
 */
function createPlant({ potColor = 0x7a4a2f, leafColor = 0x3a7d44, leafClusters = 5 } = {}) {
  const plant = new THREE.Group();
  plant.name = "prop:plant";

  const POT_RADIUS = 0.15;
  const POT_HEIGHT = 0.2;

  // Vaso
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(POT_RADIUS, POT_RADIUS * 0.8, POT_HEIGHT, 12),
    new THREE.MeshStandardMaterial({ color: potColor, roughness: 0.8 })
  );
  pot.position.y = POT_HEIGHT / 2;
  pot.castShadow = true;
  pot.receiveShadow = true;
  plant.add(pot);

  // Folhagem: várias esferas levemente achatadas e deslocadas,
  // pra não parecer uma bola perfeita — usa um seed fixo (não Math.random
  // puro sem controle) só pra variar a forma sem ficar idêntico ao lado.
  const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.9 });
  let maxTop = POT_HEIGHT;

  for (let i = 0; i < leafClusters; i++) {
    const angle = (i / leafClusters) * Math.PI * 2;
    const radiusOffset = 0.08 + (i % 3) * 0.015;
    const heightOffset = 0.22 + (i % 2) * 0.08;

    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 + (i % 2) * 0.03, 8, 6),
      leafMat
    );
    leaf.scale.set(1, 1.3, 1);
    leaf.position.set(
      Math.cos(angle) * radiusOffset,
      POT_HEIGHT + heightOffset,
      Math.sin(angle) * radiusOffset
    );
    leaf.castShadow = true;
    plant.add(leaf);

    maxTop = Math.max(maxTop, leaf.position.y + 0.12);
  }

  plant.userData = {
    propType: "plant",
    footprint: { width: POT_RADIUS * 2, depth: POT_RADIUS * 2 },
    totalHeight: maxTop,
  };

  return plant;
}

module.exports = { createPlant };