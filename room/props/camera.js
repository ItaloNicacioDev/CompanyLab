/**
 * camera.js
 *
 * Peça reutilizável: câmera de produção (equipamento físico, não a
 * THREE.Camera da cena). Usada em salas de Video Production / mídia
 * (seção 22 e 30 do spec).
 */

const THREE = require("three");

/**
 * @param {object} [options]
 * @param {number} [options.bodyColor=0x111111]
 * @param {number} [options.lensColor=0x0a0a0a]
 * @param {number} [options.tripodColor=0x2a2a2a]
 * @returns {THREE.Group}
 */
function createCamera({ bodyColor = 0x111111, lensColor = 0x0a0a0a, tripodColor = 0x2a2a2a } = {}) {
  const cameraProp = new THREE.Group();
  cameraProp.name = "prop:camera";

  const TRIPOD_HEIGHT = 1.1;

  // Tripé: 3 pernas inclinadas saindo de um pivô central
  const legGeo = new THREE.CylinderGeometry(0.012, 0.012, TRIPOD_HEIGHT, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: tripodColor, roughness: 0.6, metalness: 0.4 });

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(Math.cos(angle) * 0.15, TRIPOD_HEIGHT / 2, Math.sin(angle) * 0.15);
    leg.rotation.z = Math.cos(angle) * 0.35;
    leg.rotation.x = Math.sin(angle) * -0.35;
    leg.castShadow = true;
    cameraProp.add(leg);
  }

  // Cabeça do tripé
  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12),
    new THREE.MeshStandardMaterial({ color: tripodColor, metalness: 0.5 })
  );
  head.position.y = TRIPOD_HEIGHT;
  cameraProp.add(head);

  // Corpo da câmera
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.12, 0.14),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.4 })
  );
  body.position.set(0, TRIPOD_HEIGHT + 0.08, 0);
  body.castShadow = true;
  cameraProp.add(body);

  // Lente
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: lensColor, roughness: 0.2, metalness: 0.6 })
  );
  lens.rotation.z = Math.PI / 2;
  lens.position.set(0.15, TRIPOD_HEIGHT + 0.08, 0);
  lens.castShadow = true;
  cameraProp.add(lens);

  cameraProp.userData = {
    propType: "camera",
    footprint: { width: 0.35, depth: 0.35 },
  };

  return cameraProp;
}

module.exports = { createCamera };