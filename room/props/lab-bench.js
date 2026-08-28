/**
 * lab-bench.js
 *
 * Peça reutilizável: bancada de laboratório com equipamento (béqueres).
 * Usada em salas de Research / R&D (seção 22 do spec).
 */

const THREE = require("three");

/**
 * @param {object} [options]
 * @param {number} [options.benchColor=0xd9d9d9] - cor do tampo (granito claro)
 * @param {number} [options.baseColor=0x2f2f2f]
 * @param {number} [options.liquidColor=0x22c55e] - cor do líquido nos béqueres
 * @returns {THREE.Group}
 */
function createLabBench({ benchColor = 0xd9d9d9, baseColor = 0x2f2f2f, liquidColor = 0x22c55e } = {}) {
  const bench = new THREE.Group();
  bench.name = "prop:labBench";

  const BENCH_WIDTH = 1.6;
  const BENCH_DEPTH = 0.6;
  const BENCH_HEIGHT = 0.85;

  // Base/armário
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(BENCH_WIDTH, BENCH_HEIGHT - 0.05, BENCH_DEPTH),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.7 })
  );
  base.position.y = (BENCH_HEIGHT - 0.05) / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  bench.add(base);

  // Tampo (granito)
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(BENCH_WIDTH + 0.05, 0.05, BENCH_DEPTH + 0.05),
    new THREE.MeshStandardMaterial({ color: benchColor, roughness: 0.3 })
  );
  top.position.y = BENCH_HEIGHT - 0.025;
  top.castShadow = true;
  top.receiveShadow = true;
  bench.add(top);

  // Béqueres com "líquido" (2 unidades, tamanhos variados)
  const beakerSpecs = [
    { x: -0.35, radius: 0.05, height: 0.12 },
    { x: -0.15, radius: 0.035, height: 0.09 },
  ];

  beakerSpecs.forEach(({ x, radius, height }) => {
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 0.85, height, 12, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.25,
        roughness: 0.1,
        side: THREE.DoubleSide,
      })
    );
    glass.position.set(x, BENCH_HEIGHT + height / 2, 0);
    bench.add(glass);

    const liquid = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.9, radius * 0.8, height * 0.5, 12),
      new THREE.MeshStandardMaterial({ color: liquidColor, roughness: 0.4 })
    );
    liquid.position.set(x, BENCH_HEIGHT + height * 0.25, 0);
    bench.add(liquid);
  });

  // Microscópio simplificado
  const microscopeBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
  );
  microscopeBase.position.set(0.25, BENCH_HEIGHT + 0.01, 0);
  bench.add(microscopeBase);

  const microscopeArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.16, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a })
  );
  microscopeArm.position.set(0.22, BENCH_HEIGHT + 0.09, 0);
  microscopeArm.rotation.z = 0.15;
  bench.add(microscopeArm);

  bench.userData = {
    propType: "labBench",
    footprint: { width: BENCH_WIDTH + 0.05, depth: BENCH_DEPTH + 0.05 },
    surfaceHeight: BENCH_HEIGHT,
  };

  return bench;
}

module.exports = { createLabBench };