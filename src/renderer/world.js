/**
 * world.js — CompanyLab 3D World Engine
 *
 * Sistema completo de mundo 3D com:
 *  - FPS controls (PointerLock, sem depender de extras do Three.js)
 *  - WASD + mouse look
 *  - Salas por departamento (paredes glass + porta)
 *  - Agentes como avatares 3D dentro das salas
 *  - Raycasting gaze-based para interação
 *  - Labels HTML projetadas no espaço 3D
 *  - Animações idle (bob + pulse)
 */

'use strict';

const THREE = require('three');
const path  = require('path');
const fs    = require('fs');
const { pathToFileURL } = require('url');

// ─── Modelos 3D reais (assets/agents/models) ──────────────────────────────────
// Se existir um .glb com o nome certo aqui dentro, ele substitui o boneco
// procedural (cilindro/esfera) por um modelo de verdade. Se o arquivo ainda
// não existir, o boneco procedural continua sendo usado normalmente — é um
// upgrade opcional, não uma dependência obrigatória. Ver assets/agents/models/README.md
// pra especificação completa (nomes de arquivo, esqueleto, materiais).
const MODELS_DIR = path.join(__dirname, '..', '..', 'assets', 'agents', 'models');
const MODEL_CACHE = new Map();   // fileName -> Promise<{root:THREE.Object3D, clips:THREE.AnimationClip[]}|null>
const TARGET_HEIGHT = 1.5;       // altura alvo (metros) pra normalizar qualquer .glb que caia aqui
let gltfLoaderModulePromise = null;

function getGLTFLoaderModule() {
  // GLTFLoader.js (dentro de three/examples/jsm) é ES Module puro — não dá
  // pra usar require() nele como no resto do projeto (CommonJS). O Node
  // que roda dentro do Electron (nodeIntegration: true) suporta import()
  // dinâmico dentro de um arquivo CommonJS, então usamos isso aqui.
  if (!gltfLoaderModulePromise) {
    gltfLoaderModulePromise = import('three/examples/jsm/loaders/GLTFLoader.js');
  }
  return gltfLoaderModulePromise;
}

let skeletonUtilsModulePromise = null;
function getSkeletonUtilsModule() {
  // Object3D.clone() comum NÃO duplica esqueleto corretamente em modelos
  // rigged/animados (SkinnedMesh) — todos os clones acabariam compartilhando
  // os MESMOS ossos, e animar um agente moveria todos ao mesmo tempo.
  // SkeletonUtils.clone() é o jeito certo de clonar um modelo com esqueleto.
  if (!skeletonUtilsModulePromise) {
    skeletonUtilsModulePromise = import('three/examples/jsm/utils/SkeletonUtils.js');
  }
  return skeletonUtilsModulePromise;
}

/**
 * Carrega (e cacheia) um .glb de assets/agents/models. Retorna null se não
 * existir/der erro — nunca lança. Normaliza escala e posição: qualquer
 * modelo, seja qual for a escala/orientação original do arquivo original,
 * vira um personagem de ~1,5 m com os pés em y=0 — não precisa ajustar
 * escala manualmente por arquivo antes de soltar ele na pasta.
 */
async function loadAgentModel(fileName) {
  if (MODEL_CACHE.has(fileName)) return MODEL_CACHE.get(fileName);

  const promise = (async () => {
    const filePath = path.join(MODELS_DIR, fileName);
    if (!fs.existsSync(filePath)) return null; // ainda não existe -> modo procedural, sem warning

    try {
      const { GLTFLoader } = await getGLTFLoaderModule();
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(pathToFileURL(filePath).href);

      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const scale = TARGET_HEIGHT / (size.y || 1);

      const wrapper = new THREE.Group();
      const inner = new THREE.Group();
      inner.position.y = -box.min.y; // pés em y=0 (em unidades originais, antes de escalar)
      inner.add(gltf.scene);
      wrapper.add(inner);
      wrapper.scale.setScalar(scale);

      return { root: wrapper, clips: gltf.animations || [] };
    } catch (err) {
      console.warn('[World] Falha ao carregar modelo 3D "' + fileName + '", usando boneco procedural.', err);
      return null;
    }
  })();

  MODEL_CACHE.set(fileName, promise);
  return promise;
}

// ─── World Constants ──────────────────────────────────────────────────────────
const PLAYER_HEIGHT = 1.7;
const MOVE_SPEED    = 9;
const SPRINT_SPEED  = 18;
const LOOK_SENS     = 0.0018;
const INTERACT_DIST = 5.5;
const DOOR_DIST     = 4.0;   // proximity to trigger "enter room" prompt
const ROOM_RADIUS   = 24;
const RW = 13, RH = 3.8, RD = 13;   // room width, height, depth
const DOOR_W = 3.5, DOOR_H = 2.6;

// Zoom da rodinha do mouse (só ativo com o ponteiro destravado)
const OVERVIEW_ZOOM_SPEED  = 0.02;  // unidades de mundo por unidade de deltaY
const OVERVIEW_MIN_HEIGHT  = 1.2;   // nunca deixa a câmera descer pra dentro do chão
const OVERVIEW_MAX_DIST    = 100;   // não deixa afastar demais do escritório

const STATUS_COLORS = {
  working: 0x22c55e,
  idle:    0x475569,
  blocked: 0xf59e0b,
  error:   0xef4444,
};

const DEPT_PALETTE = [
  0x3b82f6, 0x8b5cf6, 0x22c55e,
  0xf59e0b, 0xef4444, 0x06b6d4,
  0xec4899, 0x84cc16,
];

// ─── World Class ──────────────────────────────────────────────────────────────
class World {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   onAgentSelect: (agent) => void,
   *   onPointerLock: (locked: boolean) => void,
   *   onRoomEnter:   (deptName: string) => void,
   *   onRoomExit:    () => void,
   *   onPrompt:      (text: string|null) => void,
   * }} cb
   */
  constructor(container, cb = {}) {
    this.container   = container;
    this.cb          = cb;
    this.departments = [];
    this.agents      = [];
    this.rooms       = [];   // Room objects
    this.agentObjs   = [];   // { group, labelEl, agentData, worldPos, bobPhase }
    this.labelLayer  = null;

    // FPS state
    this.isLocked   = false;
    this.keys       = {};
    this.euler      = new THREE.Euler(0, 0, 0, 'YXZ');
    this.clock      = new THREE.Clock();

    // Interaction state
    this.raycaster      = new THREE.Raycaster();
    this.raycaster.far  = INTERACT_DIST;
    this.gazedAgent     = null;
    this.gazeTimer      = 0;
    this.currentRoom    = null;
    this.nearDoor       = null;
    this._promptCurrent = null;

    // Three.js core
    this.scene    = null;
    this.camera   = null;
    this.renderer = null;
    this._raf     = null;

    this._initRenderer();
    this._initScene();
    this._initFPS();
    this._animate();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Renderer + Scene
  // ──────────────────────────────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.container.appendChild(this.renderer.domElement);

    // HTML label overlay
    this.labelLayer = document.createElement('div');
    this.labelLayer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;';
    this.container.appendChild(this.labelLayer);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080f1c);
    this.scene.fog = new THREE.FogExp2(0x080f1c, 0.018);

    this.camera = new THREE.PerspectiveCamera(
      72, window.innerWidth / window.innerHeight, 0.1, 150
    );
    this.camera.position.set(0, PLAYER_HEIGHT, 30);

    // ── Lights ──────────────────────────────────────
    this.scene.add(new THREE.AmbientLight(0x1a2740, 5));

    const sun = new THREE.DirectionalLight(0x5577cc, 1.4);
    sun.position.set(20, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 1;
    sun.shadow.camera.far    = 150;
    sun.shadow.camera.left   = -70;
    sun.shadow.camera.right  =  70;
    sun.shadow.camera.top    =  70;
    sun.shadow.camera.bottom = -70;
    this.scene.add(sun);

    const fill = new THREE.PointLight(0x3b82f6, 2.5, 80);
    fill.position.set(0, 12, 0);
    this.scene.add(fill);

    // ── Floor ────────────────────────────────────────
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0x0a1628, roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // ── Grid ─────────────────────────────────────────
    const grid = new THREE.GridHelper(160, 160, 0x1e3a5f, 0x0d2140);
    grid.position.y = 0.015;
    this.scene.add(grid);

    // ── Center platform ──────────────────────────────
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 0.08, 32),
      new THREE.MeshStandardMaterial({
        color: 0x1e3a5f, roughness: 0.5, metalness: 0.4,
        emissive: 0x1e3a5f, emissiveIntensity: 0.3,
      })
    );
    plat.position.y = 0.04;
    this.scene.add(plat);

    // Center ring glow
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.8, 5.1, 64),
      new THREE.MeshBasicMaterial({ color: 0x3b82f6, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    this.scene.add(ring);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FPS Controls (PointerLock implemented inline)
  // ──────────────────────────────────────────────────────────────────────────

  _initFPS() {
    const canvas = this.renderer.domElement;

    // Click canvas to lock pointer
    canvas.addEventListener('click', () => {
      if (!this.isLocked) canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === canvas;
      this.cb.onPointerLock?.(this.isLocked);
      if (!this.isLocked) {
        this.keys = {};
        this._setPrompt(null);
      }
    });

    // Mouse look
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * LOOK_SENS;
      this.euler.x -= e.movementY * LOOK_SENS;
      this.euler.x = Math.max(-1.35, Math.min(1.35, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    });

    // Key bindings
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' && this.isLocked) this._tryInteract();
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Zoom (rodinha do mouse) — só na visão geral (ponteiro destravado).
    // Em modo FPS a rodinha não faz nada, pra não conflitar com o
    // movimento/sprint do WASD.
    canvas.addEventListener('wheel', (e) => {
      if (this.isLocked) return;
      e.preventDefault();
      this._zoomOverview(e.deltaY);
    }, { passive: false });
  }

  /**
   * Aproxima/afasta a câmera na direção pra onde ela já está olhando
   * (dolly zoom) — funciona com a câmera em qualquer posição/ângulo,
   * não depende de setPassive() ter sido chamado antes.
   * @param {number} deltaY - e.deltaY do evento 'wheel'
   */
  _zoomOverview(deltaY) {
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);

    // Scroll pra cima (deltaY negativo) = aproxima; pra baixo = afasta.
    const step = -deltaY * OVERVIEW_ZOOM_SPEED;
    this.camera.position.addScaledVector(forward, step);

    // Não deixa a câmera atravessar o chão nem se afastar demais do escritório.
    this.camera.position.y = Math.max(this.camera.position.y, OVERVIEW_MIN_HEIGHT);
    const dist = this.camera.position.length();
    if (dist > OVERVIEW_MAX_DIST) {
      this.camera.position.setLength(OVERVIEW_MAX_DIST);
    }
  }

  _tryInteract() {
    if (this.gazedAgent) {
      this.cb.onAgentSelect?.(this.gazedAgent.agentData);
      return;
    }
    if (this.nearDoor) {
      this._teleportIntoRoom(this.nearDoor);
    }
  }

  /**
   * Pede o Pointer Lock explicitamente — chamado pelo overlay
   * "Explorar Escritório" no renderer.js. Fica aqui (em vez do
   * renderer.js fazer um `document.querySelector` solto) pra sempre
   * usar a MESMA instância de canvas que o World já tem internamente,
   * e pra logar caso o navegador rejeite o pedido, em vez de falhar
   * em silêncio sem nenhuma pista no console.
   */
  requestEnter() {
    if (this.isLocked) return;
    const result = this.renderer.domElement.requestPointerLock();
    // Chromium recente (inclui o Electron) retorna uma Promise de
    // requestPointerLock() — se ela rejeitar, o motivo aparece aqui.
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        console.error('[World] requestPointerLock() foi rejeitado:', err);
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Room Builder
  // ──────────────────────────────────────────────────────────────────────────

  _buildRooms() {
    const n = this.departments.length;
    if (n === 0) return;

    this.departments.forEach((dept, i) => {
      const angle = (i / n) * Math.PI * 2;
      const cx    = Math.cos(angle) * ROOM_RADIUS;
      const cz    = Math.sin(angle) * ROOM_RADIUS;
      const color = DEPT_PALETTE[i % DEPT_PALETTE.length];

      const group = new THREE.Group();
      group.position.set(cx, 0, cz);

      // Door faces toward origin: rotate so local +Z points to center
      group.rotation.y = Math.atan2(-cx, -cz);

      // ── Room geometry ──────────────────────────────
      const wallMat = () => new THREE.MeshStandardMaterial({
        color, transparent: true, opacity: 0.12,
        roughness: 0.3, metalness: 0.6,
        emissive: color, emissiveIntensity: 0.06,
        side: THREE.DoubleSide,
      });
      const edgeMat = () => new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0.5,
      });

      const addWall = (w, h, d, px, py, pz) => {
        const geo  = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, wallMat());
        mesh.position.set(px, py, pz);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat());
        edges.position.set(px, py, pz);
        group.add(edges);
      };

      const t  = 0.15; // wall thickness
      const hw = RW / 2, hd = RD / 2;

      // Back wall
      addWall(RW, RH, t, 0, RH / 2, -hd);
      // Left wall
      addWall(t, RH, RD, -hw, RH / 2, 0);
      // Right wall
      addWall(t, RH, RD,  hw, RH / 2, 0);

      // Front wall — two segments (door gap)
      const sideW = (RW - DOOR_W) / 2;
      addWall(sideW, RH, t, -(hw - sideW / 2), RH / 2, hd);
      addWall(sideW, RH, t,  (hw - sideW / 2), RH / 2, hd);
      // Lintel above door
      const lintelH = RH - DOOR_H;
      if (lintelH > 0.01) {
        addWall(DOOR_W, lintelH, t, 0, DOOR_H + lintelH / 2, hd);
      }

      // ── Floor inside room ──────────────────────────
      const innerFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(RW - t * 2, RD - t * 2),
        new THREE.MeshStandardMaterial({ color: 0x0d1e35, roughness: 0.9 })
      );
      innerFloor.rotation.x = -Math.PI / 2;
      innerFloor.position.y = 0.02;
      innerFloor.receiveShadow = true;
      group.add(innerFloor);

      // ── Room glow light ─────────────────────────────
      const pt = new THREE.PointLight(color, 1.2, 20);
      pt.position.set(0, RH * 0.75, 0);
      group.add(pt);

      // ── Department name sprite ──────────────────────
      group.add(this._makeTextSprite(dept.name, dept.icon || '', color, RH + 0.9));

      this.scene.add(group);

      // Store room record
      this.rooms.push({
        deptId: dept.id,
        deptName: dept.name,
        color,
        group,
        worldBox: null,   // computed below
        doorWorldPos: new THREE.Vector3(),
      });
    });

    // Force matrix update so localToWorld is accurate
    this.scene.updateMatrixWorld(true);

    this.rooms.forEach((room) => {
      // World bounding box (for "is player inside?" check)
      room.worldBox = new THREE.Box3().setFromObject(room.group);

      // Door world position (local 0, DOOR_H/2, RD/2)
      room.group.localToWorld(room.doorWorldPos.set(0, DOOR_H / 2, RD / 2));
    });
  }

  _makeTextSprite(name, icon, hexColor, yOffset) {
    const canvas  = document.createElement('canvas');
    canvas.width  = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    const hex = '#' + hexColor.toString(16).padStart(6, '0');

    ctx.font = 'bold 34px Inter, system-ui, sans-serif';
    ctx.fillStyle = hex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = hex;
    ctx.shadowBlur  = 14;
    ctx.fillText((icon ? icon + ' ' : '') + name.toUpperCase(), 256, 48);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(7, 1.4, 1);
    spr.position.set(0, yOffset, 0);
    return spr;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Agent Placement
  // ──────────────────────────────────────────────────────────────────────────

  _buildAgents() {
    const byDept = {};
    this.agents.forEach(a => {
      const key = a.departmentId || '__none__';
      (byDept[key] = byDept[key] || []).push(a);
    });

    this.rooms.forEach(room => {
      const roomAgents = byDept[room.deptId] || [];
      const n = roomAgents.length;

      roomAgents.forEach((agent, i) => {
        // Spread agents in a small arc inside the room (local space)
        const spread = Math.min(n - 1, 4);
        const lx = spread > 0 ? ((i / spread) - 0.5) * (RW * 0.55) : 0;
        const lz = -RD * 0.2 - (Math.floor(i / 5) * 2.5);

        const localPos = new THREE.Vector3(lx, 0, lz);
        const worldPos = room.group.localToWorld(localPos.clone());

        const group = this._makeAgentMesh(agent);
        group.position.copy(worldPos);

        // Face toward door (local +Z direction = door = world facing room center)
        const doorDir = room.group.localToWorld(new THREE.Vector3(0, 0, 1)).sub(worldPos).normalize();
        const target  = worldPos.clone().add(doorDir);
        group.lookAt(target.x, worldPos.y, target.z);

        this.scene.add(group);

        // Tenta trocar o boneco procedural por um modelo 3D de verdade,
        // se existir em assets/agents/models (ver README lá dentro).
        // Assíncrono e "best effort": se não achar o arquivo, o boneco
        // procedural que já está na tela continua exatamente como está.
        this._tryAttachRealModel(group, this._parseAvatarConfig(agent));

        const labelEl = this._makeAgentLabelEl(agent);
        this.labelLayer.appendChild(labelEl);

        this.agentObjs.push({
          group,
          labelEl,
          agentData: agent,
          worldPos:  worldPos.clone(),
          bobPhase:  Math.random() * Math.PI * 2,
          rig: group.userData.rig || null, // { legL, legR, armL, armR, headGroup }

          // Estação de trabalho "de casa" — pra onde o agente sempre
          // volta depois de circular pelo escritório (seção "bonecos
          // precisam se movimentar entre as salas").
          homeRoom: room,
          homePos:  worldPos.clone(),
          wander: {
            state: 'idle',            // 'idle' | 'walking' | 'pausing'
            nextWanderAt: performance.now() / 1000 + 6 + Math.random() * 18,
            path: [],
            pathIndex: 0,
            returning: false,
            pauseUntil: 0,
            speed: 1.1 + Math.random() * 0.5,
          },
        });
      });
    });
  }

  /** Parseia `agent.avatar` (JSON salvo pelo modal de criação) com defaults sensatos. */
  _parseAvatarConfig(agent) {
    let cfg = {};
    if (agent.avatar) {
      try { cfg = JSON.parse(agent.avatar); } catch { cfg = {}; }
    }
    return {
      skinColor: cfg.skinColor || '#f1c27d',
      hairColor: cfg.hairColor || '#2d1b0e',
      hairStyle: cfg.hairStyle || 'short',
      outfitColor: cfg.outfitColor || '#3b82f6',
      furry:     !!cfg.furry,
      furSpecies: cfg.furSpecies || 'fox',
      furColor:  cfg.furColor || '#d97706',
    };
  }

  /** Escurece/clareia uma cor hex por um fator (-1..1) — usado pra derivar calça/sapato a partir da roupa. */
  _shade(hexColor, amount) {
    const c = new THREE.Color(hexColor);
    if (amount < 0) c.multiplyScalar(1 + amount);
    else c.lerp(new THREE.Color(0xffffff), amount);
    return c;
  }

  /** Nome do arquivo .glb esperado pra essa combinação de aparência (ver assets/agents/models/README.md). */
  _modelFileFor(av) {
    if (av.furry) {
      const known = ['fox', 'wolf', 'cat', 'rabbit'];
      const species = known.includes(av.furSpecies) ? av.furSpecies : 'fox';
      return `furry_${species}.glb`;
    }
    return 'human_base.glb';
  }

  /**
   * Tenta substituir o boneco procedural (já visível) por um modelo 3D
   * de verdade carregado de assets/agents/models. Roda em background —
   * não bloqueia nada, e se o arquivo não existir simplesmente não faz
   * nada (o procedural continua sendo o boneco final).
   */
  async _tryAttachRealModel(group, av) {
    const fileName = this._modelFileFor(av);
    const loaded = await loadAgentModel(fileName);
    if (!loaded) return;            // arquivo não existe ainda -> segue procedural
    if (!group.parent) return;      // agente já foi removido/repopulado nesse meio-tempo

    const { SkeletonUtils } = await getSkeletonUtilsModule();
    const model = SkeletonUtils.clone(loaded.root);
    model.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.material = Array.isArray(child.material)
        ? child.material.map(m => m.clone())
        : child.material.clone();
      // A geometria NÃO é clonada de propósito (clone barato, reaproveita
      // a mesma malha carregada do disco pra todos os agentes iguais) —
      // então nunca pode ser descartada no populate(), só a instância do
      // material. Ver o dispose loop em populate().
      child.userData.sharedGeometry = true;
      this._tintModelMesh(child, av);
    });

    // Esconde (não remove) o boneco procedural — fica como fallback vivo:
    // se um dia o .glb for removido, um novo populate() volta a mostrá-lo.
    group.children.forEach(c => { c.visible = false; });
    model.userData.isRealModel = true;
    group.add(model);
    group.userData.modelRoot = model;

    // Animação: toca automaticamente se o .glb tiver clipes embutidos.
    // Convenção: clipe chamado "Walk" toca enquanto o agente anda; o
    // primeiro clipe "parado" que achar (Idle/Survey/Standing, ou
    // simplesmente o primeiro da lista) toca o resto do tempo.
    if (loaded.clips.length) {
      const mixer = new THREE.AnimationMixer(model);
      const byName = (re) => loaded.clips.find(c => re.test(c.name || ''));
      const walkClip = byName(/walk/i);
      const idleClip = byName(/idle|survey|stand/i) || loaded.clips[0];
      group.userData.mixer = mixer;
      group.userData.idleAction = idleClip ? mixer.clipAction(idleClip) : null;
      group.userData.walkAction = walkClip ? mixer.clipAction(walkClip) : null;
      group.userData.currentAction = group.userData.idleAction || group.userData.walkAction || null;
      if (group.userData.currentAction) group.userData.currentAction.play();
    }
  }

  /**
   * Pinta um mesh do modelo carregado de acordo com o nome do material/mesh.
   * Convenção esperada nos arquivos .glb (ver README): materiais chamados
   * Skin/Fur, Hair, Outfit e Pants controlam a customização do agente —
   * qualquer outro nome (sapato, botão, etc.) fica com a cor original do
   * arquivo, sem ser mexido.
   */
  _tintModelMesh(mesh, av) {
    const key = ((mesh.material && mesh.material.name) || mesh.name || '').toLowerCase();
    const applyTo = (mat, hexColor) => { if (mat && mat.color) mat.color.set(hexColor); };
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    if (key.includes('skin') || key.includes('fur')) {
      mats.forEach(m => applyTo(m, av.furry ? av.furColor : av.skinColor));
    } else if (key.includes('hair')) {
      mats.forEach(m => applyTo(m, av.hairColor));
    } else if (key.includes('outfit') || key.includes('hoodie') || key.includes('shirt')) {
      mats.forEach(m => applyTo(m, av.outfitColor));
    } else if (key.includes('pants')) {
      mats.forEach(m => applyTo(m, this._shade(av.outfitColor, -0.45)));
    }
  }

  /**
   * Boneco 3D estilizado, proporção "chibi" (cabeça grande, corpo curto e
   * arredondado) pra ficar parecido com a referência do usuário — nada de
   * torso/perna em caixa reta (isso que deixava o boneco "quadrado/robô").
   * Pernas e braços são grupos articulados (pivots nos quadris/ombros) pra
   * dar ciclo de passada de verdade ao andar, gesto de digitação ao
   * trabalhar, e um leve "olhar ao redor" quando ocioso — ver
   * _updateAgentAnims. Cabeça é um Group próprio (headGroup) pra cabelo/
   * orelhas/focinho/rabo furry acompanharem o giro da cabeça.
   */
  _makeAgentMesh(agent) {
    const statusColor = STATUS_COLORS[agent.status] ?? STATUS_COLORS.idle;
    const av    = this._parseAvatarConfig(agent);
    const g     = new THREE.Group();
    g.userData.agentId = agent.id;

    const outfitColor = av.outfitColor;
    const pantsColor  = this._shade(outfitColor, -0.45);
    const skinMat     = new THREE.MeshStandardMaterial({ color: av.skinColor, roughness: 0.7 });
    // Furries são cobertos de pelo da cabeça às mãos/pés — usar a cor de
    // pele humana ali ficaria com "cara de careca disfarçado"; por isso,
    // tudo que seria "pele" vira `bodyMat` (pelo se furry, pele se não).
    const furMat  = av.furry ? new THREE.MeshStandardMaterial({ color: av.furColor, roughness: 0.85 }) : null;
    const bodyMat = av.furry ? furMat : skinMat;

    const HIP_Y     = 0.46;
    const TORSO_H   = 0.5;
    const SHOULDER_Y = HIP_Y + TORSO_H;
    const HEAD_R    = 0.24; // cabeça grande = proporção chibi, como na referência
    const HEAD_Y    = SHOULDER_Y + 0.03 + HEAD_R * 0.85;

    // ── Pernas — cilindros afunilados (coxa mais grossa, tornozelo fino),
    // pivots no quadril pra poderem balançar ao caminhar. Muito mais
    // arredondado que a caixa reta que tinha antes ("boneco quadrado").
    const legGeo = new THREE.CylinderGeometry(0.075, 0.09, 0.46, 10);
    const legMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.6 });

    const makeLimbPivot = (x, y, mesh, meshOffsetY) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      mesh.position.y = meshOffsetY;
      mesh.castShadow = true;
      pivot.add(mesh);
      g.add(pivot);
      return pivot;
    };

    const legL = makeLimbPivot(-0.11, HIP_Y, new THREE.Mesh(legGeo, legMat), -0.23);
    const legR = makeLimbPivot(0.11, HIP_Y, new THREE.Mesh(legGeo, legMat), -0.23);

    // Sapatos (levemente arredondados na ponta, tipo tênis)
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.5 });
    const makeShoe = () => {
      const shoe = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.19), shoeMat);
      shoe.add(base);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), shoeMat);
      toe.scale.set(1, 0.7, 1);
      toe.position.set(0, 0, 0.1);
      shoe.add(toe);
      return shoe;
    };
    const shoeL = makeShoe();
    shoeL.position.set(0, -0.46, 0.02);
    legL.children[0].add(shoeL);
    const shoeR = makeShoe();
    shoeR.position.set(0, -0.46, 0.02);
    legR.children[0].add(shoeR);

    // ── Tronco — elipsoide (esfera esticada), não caixa. É a mudança que
    // mais tira a "cara de robô quadrado" do boneco e deixa ele redondo
    // como a referência (moletom felpudo, sem quinas).
    const torso = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 12),
      new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.55, metalness: 0.04 })
    );
    torso.scale.set(0.92, TORSO_H / 0.24 / 2, 0.72);
    torso.position.y = HIP_Y + TORSO_H / 2;
    torso.castShadow = true;
    g.add(torso);

    // Barra do capuz/gola do moletom — pequeno detalhe que ajuda a "ler"
    // como roupa e não como pele, além de esconder a costura torso/cabeça.
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.03, 8, 16),
      new THREE.MeshStandardMaterial({ color: this._shade(outfitColor, -0.15), roughness: 0.6 })
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = SHOULDER_Y - 0.01;
    g.add(collar);

    // ── Braços — cilindros afunilados, pivots no ombro ──
    const armGeo = new THREE.CylinderGeometry(0.055, 0.075, 0.28, 10);
    const armMat = new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.55 });
    const handGeo = new THREE.SphereGeometry(0.065, 10, 8);

    const makeArm = (x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, SHOULDER_Y - 0.05, 0);
      const upper = new THREE.Mesh(armGeo, armMat);
      upper.position.y = -0.14;
      upper.castShadow = true;
      pivot.add(upper);
      const hand = new THREE.Mesh(handGeo, bodyMat);
      hand.position.y = -0.31;
      pivot.add(hand);
      g.add(pivot);
      return pivot;
    };
    const armL = makeArm(-0.27);
    const armR = makeArm(0.27);

    // ── Cabeça (Group independente — gira sozinha pra "olhar ao redor") ──
    const headGroup = new THREE.Group();
    headGroup.position.y = HEAD_Y;
    g.add(headGroup);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 20, 16), bodyMat);
    headMesh.castShadow = true;
    headGroup.add(headMesh);

    // Olhinhos grandes — é o detalhe que faz parecer um personagem
    // "chibi" de verdade, não um pino
    const eyeGeo = new THREE.SphereGeometry(0.028, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x14161a });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.085, 0.01, HEAD_R - 0.035);
    headGroup.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.085, 0.01, HEAD_R - 0.035);
    headGroup.add(eyeR);
    // Pontinho de brilho no olho — dá vida ao rosto sem custar quase nada
    const glintGeo = new THREE.SphereGeometry(0.009, 6, 6);
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const glintL = new THREE.Mesh(glintGeo, glintMat);
    glintL.position.set(-0.078, 0.02, HEAD_R - 0.015);
    headGroup.add(glintL);
    const glintR = new THREE.Mesh(glintGeo, glintMat);
    glintR.position.set(0.092, 0.02, HEAD_R - 0.015);
    headGroup.add(glintR);

    if (!av.furry) this._addHair(headGroup, av, HEAD_R);
    if (av.furry) this._addFurryFeatures(headGroup, g, av, HEAD_R, HIP_Y, furMat);

    // Sombra no chão
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.32, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    g.add(shadow);

    // ── Anel de status no chão — sinaliza o estado REAL do agente sem
    // depender da cor da roupa (que agora é 100% customizável pelo
    // usuário). Continua vindo só de `agent.status`, nunca inventado
    // (seção 26/38 do spec: status é sempre real).
    const statusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 24),
      new THREE.MeshStandardMaterial({
        color: statusColor, emissive: statusColor,
        emissiveIntensity: agent.status === 'working' ? 0.85 : 0.45,
        transparent: true, opacity: agent.status === 'working' ? 0.85 : 0.55,
        side: THREE.DoubleSide,
      })
    );
    statusRing.rotation.x = -Math.PI / 2;
    statusRing.position.y = 0.015;
    if (agent.status === 'working') statusRing.userData.isPulse = true;
    g.add(statusRing);

    // Guarda as referências do "esqueleto" pra animação (caminhada, digitar, olhar ao redor)
    g.userData.rig = { legL, legR, armL, armR, headGroup };

    return g;
  }

  /** Adiciona cabelo na cabeça, no estilo escolhido (seção "bonecos genéricos"). */
  _addHair(headGroup, av, headR) {
    if (av.hairStyle === 'bald') return;

    const hairMat = new THREE.MeshStandardMaterial({ color: av.hairColor, roughness: 0.8 });

    if (av.hairStyle === 'short' || av.hairStyle === 'bun') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.03, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      cap.castShadow = true;
      headGroup.add(cap);

      if (av.hairStyle === 'bun') {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), hairMat);
        bun.position.set(0, headR * 0.8, -headR * 0.7);
        headGroup.add(bun);
      }
    } else if (av.hairStyle === 'long') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.03, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      headGroup.add(cap);

      // Mecha longa caindo atrás da cabeça
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.09, 0.4, 10), hairMat);
      strand.position.set(0, -0.18, -headR * 0.6);
      strand.castShadow = true;
      headGroup.add(strand);
    } else if (av.hairStyle === 'mohawk') {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.3), hairMat);
      strip.position.y = headR * 0.9;
      strip.castShadow = true;
      headGroup.add(strip);
    }
  }

  /**
   * Adiciona focinho, orelhas (na cabeça), rabo de animal (no quadril) e
   * uma "franja" de pelo no topo da cabeça quando o agente é "furry".
   * `bodyFurMat` é o mesmo material já usado na cabeça/mãos, passado pra
   * cá pra reaproveitar (menos materiais = mais leve).
   */
  _addFurryFeatures(headGroup, g, av, headR, hipY, bodyFurMat) {
    const furMat = bodyFurMat || new THREE.MeshStandardMaterial({ color: av.furColor, roughness: 0.9 });
    const isLongEar = av.furSpecies === 'wolf' || av.furSpecies === 'rabbit';
    const earGeo = av.furSpecies === 'cat' || av.furSpecies === 'fox'
      ? new THREE.ConeGeometry(0.06, 0.14, 8)
      : new THREE.SphereGeometry(0.07, 8, 8); // wolf/rabbit: orelhas mais arredondadas/compridas

    const earL = new THREE.Mesh(earGeo, furMat);
    const earR = new THREE.Mesh(earGeo, furMat);
    const earY = av.furSpecies === 'rabbit' ? headR * 1.35 : headR * 0.9;
    earL.position.set(-0.14, earY, -0.02);
    earR.position.set(0.14, earY, -0.02);
    if (isLongEar) {
      earL.scale.set(0.6, av.furSpecies === 'rabbit' ? 2.4 : 1.6, 0.6);
      earR.scale.set(0.6, av.furSpecies === 'rabbit' ? 2.4 : 1.6, 0.6);
    }
    earL.castShadow = earR.castShadow = true;
    headGroup.add(earL, earR);

    // Focinho — sem isso a cabeça lê como "gente careca pintada", não
    // como bicho. Um pequeno bico arredondado na frente do rosto, com
    // uma trufa (nariz) preta na ponta.
    const muzzleColor = this._shade(av.furColor, 0.28);
    const muzzleMat = new THREE.MeshStandardMaterial({ color: muzzleColor, roughness: 0.85 });
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.52, 12, 10), muzzleMat);
    muzzle.scale.set(0.85, 0.65, 0.95);
    muzzle.position.set(0, -headR * 0.28, headR * 0.72);
    muzzle.castShadow = true;
    headGroup.add(muzzle);

    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(headR * 0.13, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.4 })
    );
    nose.scale.set(1, 0.75, 0.85);
    nose.position.set(0, -headR * 0.22, headR * 1.16);
    headGroup.add(nose);

    // Franja de pelo no topo — usa a cor de "cabelo" escolhida como um
    // segundo tom de pelagem (padrão comum em designs furry), respeitando
    // o estilo escolhido no builder (careca = liso, moicano = crista, etc).
    this._addHair(headGroup, av, headR * 0.98);

    // Rabo, saindo da base das costas (quadril) — fica no corpo, não na cabeça
    const tailGeo = av.furSpecies === 'rabbit'
      ? new THREE.SphereGeometry(0.09, 10, 8)
      : new THREE.ConeGeometry(0.075, 0.34, 8);
    const tail = new THREE.Mesh(tailGeo, furMat);
    tail.position.set(0, hipY - 0.02, -0.26);
    if (av.furSpecies !== 'rabbit') tail.rotation.x = Math.PI * 0.6;
    tail.castShadow = true;
    g.add(tail);
  }

  _makeAgentLabelEl(agent) {
    const el = document.createElement('div');
    el.className = 'agent-label';
    el.innerHTML =
      '<span class="al-name">' + agent.name + '</span>' +
      '<span class="al-role">' + (agent.role || '') + '</span>';
    el.style.display = 'none';
    return el;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Teleport
  // ──────────────────────────────────────────────────────────────────────────

  _teleportIntoRoom(room) {
    // Enter just inside the door, facing the interior
    const entry  = room.group.localToWorld(new THREE.Vector3(0, PLAYER_HEIGHT, RD / 2 - 2));
    const lookAt = room.group.localToWorld(new THREE.Vector3(0, PLAYER_HEIGHT, -RD / 2 + 3));

    this.camera.position.copy(entry);
    this.camera.lookAt(lookAt);
    this.euler.setFromQuaternion(this.camera.quaternion);

    this.currentRoom = room;
    this.cb.onRoomEnter?.(room.deptName);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Main Loop
  // ──────────────────────────────────────────────────────────────────────────

  _animate() {
    this._raf = requestAnimationFrame(() => this._animate());

    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t  = performance.now() / 1000;

    if (this.isLocked) this._updateMovement(dt);
    this._updateRoomState();
    this._updateGaze(dt);
    this._updateAgentMovement(t, dt);
    this._updateAgentAnims(t, dt);
    this._updateHTMLLabels();

    this.renderer.render(this.scene, this.camera);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Movimentação ambiente entre salas
  //
  // Pedido do usuário: "os bonecos também precisam se movimentar entre as
  // salas, não só ficar em suas salas trabalhando, simulando verdadeiramente
  // um ambiente profissional". Isso é puramente visual/ambiente — não muda
  // nem inventa STATUS do agente (seção 26/38: status continua 100% real,
  // vindo de eventos reais) — só faz o boneco caminhar fisicamente pelo
  // escritório de vez em quando, como aconteceria num escritório de verdade.
  // ──────────────────────────────────────────────────────────────────────────

  /** Ponto na "praça" central, logo na frente da porta de uma sala. */
  _plazaPointFor(room) {
    const doorPos = room.doorWorldPos.clone().setY(0);
    // As salas ficam num círculo em volta da origem com a porta voltada
    // pro centro, então a direção porta -> centro é simplesmente -doorPos.
    const towardCenter = doorPos.clone().negate().normalize();
    return doorPos.add(towardCenter.multiplyScalar(1.8));
  }

  /** Ponto aleatório dentro de uma sala, perto da entrada (não em cima das mesas). */
  _randomSpotInRoom(room) {
    const lx = (Math.random() - 0.5) * (RW * 0.5);
    const lz = RD / 2 - 2.2 - Math.random() * 1.5;
    return room.group.localToWorld(new THREE.Vector3(lx, 0, lz));
  }

  _updateAgentMovement(t, dt) {
    for (const ao of this.agentObjs) {
      const w = ao.wander;
      if (!w) continue;

      if (w.state === 'idle') {
        if (t < w.nextWanderAt) continue;
        // Agentes travados/com erro ficam parados na mesa — o sumiço seria
        // enganoso justamente quando o usuário mais precisa ver que algo
        // está errado (mesmo princípio de nunca esconder status real).
        if (ao.agentData?.status === 'blocked' || ao.agentData?.status === 'error') {
          w.nextWanderAt = t + 8;
          continue;
        }
        this._startWander(ao, t);
        continue;
      }

      if (w.state === 'pausing') {
        if (t >= w.pauseUntil) {
          // Hora de voltar pra estação de trabalho.
          w.path = [...w.path].reverse();
          w.pathIndex = 0;
          w.returning = true;
          w.state = 'walking';
        }
        continue;
      }

      if (w.state === 'walking') {
        const target = w.path[w.pathIndex];
        if (!target) { w.state = 'idle'; continue; }

        const dx = target.x - ao.worldPos.x;
        const dz = target.z - ao.worldPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.08) {
          w.pathIndex++;
          if (w.pathIndex >= w.path.length) {
            if (w.returning) {
              w.state = 'idle';
              w.returning = false;
              w.nextWanderAt = t + 15 + Math.random() * 30;
            } else {
              w.state = 'pausing';
              w.pauseUntil = t + 4 + Math.random() * 10;
            }
          }
          continue;
        }

        const step = Math.min(dist, w.speed * dt);
        ao.worldPos.x += (dx / dist) * step;
        ao.worldPos.z += (dz / dist) * step;
        ao.group.position.x = ao.worldPos.x;
        ao.group.position.z = ao.worldPos.z;
        ao.group.rotation.y = Math.atan2(dx, dz);
      }
    }
  }

  /** Decide um destino (a praça, ou outra sala) e monta o caminho de ida. */
  _startWander(ao, t) {
    const w = ao.wander;
    const homeRoom = ao.homeRoom;
    if (!homeRoom) return;

    const otherRooms = this.rooms.filter(r => r !== homeRoom);
    const visitOther = otherRooms.length > 0 && Math.random() < 0.55;

    const ownPlaza = this._plazaPointFor(homeRoom);

    if (visitOther) {
      const targetRoom = otherRooms[Math.floor(Math.random() * otherRooms.length)];
      const targetPlaza = this._plazaPointFor(targetRoom);
      const insideSpot = this._randomSpotInRoom(targetRoom);

      w.path = [ownPlaza, targetPlaza, insideSpot];
    } else {
      // Só dá uma volta pela praça e some/volta — como ir buscar um café.
      w.path = [ownPlaza];
    }

    w.pathIndex = 0;
    w.returning = false;
    w.state = 'walking';
  }

  _updateMovement(dt) {
    const sprint  = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const speed   = sprint ? SPRINT_SPEED : MOVE_SPEED;

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0; right.normalize();

    const move = new THREE.Vector3();
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    move.add(fwd);
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  move.sub(fwd);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) move.add(right);
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      this.camera.position.addScaledVector(move, 1);
    }

    // Clamp to floor
    this.camera.position.y = PLAYER_HEIGHT;

    // Soft boundary — don't let player go too far from map
    const dist = this.camera.position.length();
    if (dist > ROOM_RADIUS + RD) {
      this.camera.position.setLength(ROOM_RADIUS + RD);
    }
  }

  _updateRoomState() {
    const pos = this.camera.position;
    let insideRoom  = null;
    let doorRoom    = null;
    let closestDoor = Infinity;

    for (const room of this.rooms) {
      // Is player inside room's world bounding box?
      if (room.worldBox && room.worldBox.containsPoint(pos)) {
        insideRoom = room;
        break;
      }
      // Distance to door
      const d = pos.distanceTo(room.doorWorldPos);
      if (d < closestDoor) {
        closestDoor = d;
        doorRoom    = room;
      }
    }

    // Room enter/exit events
    if (insideRoom !== this.currentRoom) {
      if (this.currentRoom) this.cb.onRoomExit?.();
      this.currentRoom = insideRoom;
      if (insideRoom) this.cb.onRoomEnter?.(insideRoom.deptName);
    }

    this.nearDoor = (insideRoom === null && closestDoor < DOOR_DIST) ? doorRoom : null;

    // Prompt
    if (!this.gazedAgent) {
      if (this.nearDoor) {
        this._setPrompt('[E] Entrar em ' + this.nearDoor.deptName);
      } else if (!insideRoom) {
        this._setPrompt(null);
      } else {
        this._setPrompt(null);
      }
    }
  }

  _updateGaze(dt) {
    if (!this.isLocked || this.agentObjs.length === 0) return;

    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const allMeshes = this.agentObjs.flatMap(a => a.group.children);
    const hits      = this.raycaster.intersectObjects(allMeshes, false);

    const hit = hits.length > 0
      ? this.agentObjs.find(a => a.group.children.includes(hits[0].object))
      : null;

    if (hit) {
      if (hit !== this.gazedAgent) {
        this.gazedAgent = hit;
        this.gazeTimer  = 0;
      }
      this.gazeTimer += dt;
      if (this.gazeTimer >= 0.5) {
        this._setPrompt('[E] Ver ' + hit.agentData.name);
      }
    } else {
      if (this.gazedAgent) {
        this.gazedAgent = null;
        this.gazeTimer  = 0;
        // Restore previous context prompt
        if (this.nearDoor) {
          this._setPrompt('[E] Entrar em ' + this.nearDoor.deptName);
        } else {
          this._setPrompt(null);
        }
      }
    }
  }

  /**
   * Anima o "esqueleto" de cada agente — é o que dá a liberdade real de
   * "andar pela empresa e fazer outras coisas" (pedido do usuário) vida
   * visual: ciclo de passada ao caminhar entre salas, gesto de digitação
   * enquanto o status real é 'working', e um leve olhar ao redor quando
   * está ocioso na própria mesa.
   */
  _updateAgentAnims(t, dt) {
    this.agentObjs.forEach(ao => {
      const walking = ao.wander?.state === 'walking';

      // Se o agente tem um modelo 3D real carregado (com animação
      // embutida no .glb), toca o clipe certo nele em vez de mexer no
      // rig procedural (que fica escondido nesse caso).
      const g = ao.group;
      if (g.userData.mixer) {
        g.userData.mixer.update(dt);
        const wantWalk = walking && g.userData.walkAction;
        const wantAction = wantWalk ? g.userData.walkAction : (g.userData.idleAction || g.userData.walkAction);
        if (wantAction && g.userData.currentAction !== wantAction) {
          const prev = g.userData.currentAction;
          wantAction.reset().fadeIn(0.25).play();
          if (prev) prev.fadeOut(0.25);
          g.userData.currentAction = wantAction;
        }
      }

      const hasRealAnim = !!g.userData.mixer;
      const bobAmt  = walking ? 0.018 : 0.045;
      const bobFreq = walking ? 5.2 : 1.3;
      // Modelo real com clipe de animação embutido já tem seu próprio
      // "balanço" natural ao andar — não soma o bob procedural em cima
      // pra não ficar um duplo solavanco estranho.
      const bob = hasRealAnim ? 0 : Math.sin(t * bobFreq + ao.bobPhase) * bobAmt;
      ao.group.position.y = ao.worldPos.y + bob;

      const rig = ao.rig;
      if (rig) {
        if (walking) {
          const stride = Math.sin(t * 7 + ao.bobPhase);
          if (rig.legL) rig.legL.rotation.x = stride * 0.55;
          if (rig.legR) rig.legR.rotation.x = -stride * 0.55;
          if (rig.armL) rig.armL.rotation.x = -stride * 0.4;
          if (rig.armR) rig.armR.rotation.x = stride * 0.4;
          if (rig.headGroup) rig.headGroup.rotation.y *= 0.9; // olha pra frente enquanto anda
        } else {
          // Volta as pernas/braços suavemente pra posição neutra
          if (rig.legL) rig.legL.rotation.x *= 0.85;
          if (rig.legR) rig.legR.rotation.x *= 0.85;

          if (ao.agentData?.status === 'working') {
            // Gesto de "digitando" — só aparece quando o status REAL é
            // 'working' (nunca fabricado, ver comentário no status ring).
            const type = Math.sin(t * 9 + ao.bobPhase) * 0.16;
            if (rig.armL) rig.armL.rotation.x = -0.85 + type;
            if (rig.armR) rig.armR.rotation.x = -0.85 - type;
            if (rig.headGroup) rig.headGroup.rotation.y *= 0.9;
          } else {
            if (rig.armL) rig.armL.rotation.x *= 0.88;
            if (rig.armR) rig.armR.rotation.x *= 0.88;
            // Olhar ao redor devagar — só quando parado e não trabalhando
            if (rig.headGroup) rig.headGroup.rotation.y = Math.sin(t * 0.35 + ao.bobPhase) * 0.4;
          }
        }
      }

      ao.group.children.forEach(c => {
        if (!c.userData.isPulse) return;
        const s = 1 + Math.sin(t * 2.8 + ao.bobPhase) * 0.3;
        c.scale.setScalar(s);
        if (c.material) {
          c.material.opacity = 0.45 + Math.sin(t * 2.8 + ao.bobPhase) * 0.3;
        }
      });
    });
  }

  _updateHTMLLabels() {
    const W = window.innerWidth, H = window.innerHeight;
    const v = new THREE.Vector3();

    this.agentObjs.forEach(ao => {
      // Project head position (y=1.65) to screen
      v.copy(ao.group.position).setY(ao.group.position.y + 1.65);
      v.project(this.camera);

      const sx = (v.x * 0.5 + 0.5) * W;
      const sy = (-v.y * 0.5 + 0.5) * H;
      const inFront = v.z < 1;
      const dist    = this.camera.position.distanceTo(ao.group.position);
      const visible = inFront && sx > 0 && sx < W && sy > 0 && sy < H && dist < 22;

      ao.labelEl.style.display = visible ? 'flex' : 'none';
      if (visible) {
        ao.labelEl.style.left    = sx + 'px';
        ao.labelEl.style.top     = (sy - 52) + 'px';
        // Fade at distance
        ao.labelEl.style.opacity = Math.max(0, Math.min(1, 1 - (dist - 10) / 12));
      }
    });
  }

  _setPrompt(text) {
    if (text === this._promptCurrent) return;
    this._promptCurrent = text;
    this.cb.onPrompt?.(text);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Call this after fetching departments and agents from IPC.
   * Rebuilds the entire 3D world.
   */
  populate(departments, agents) {
    // Clear old objects
    this.rooms.forEach(r => {
      r.group.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
      this.scene.remove(r.group);
    });
    this.agentObjs.forEach(a => {
      a.group.traverse(c => {
        if (c.geometry && !c.userData.sharedGeometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
      this.scene.remove(a.group);
      if (a.labelEl) a.labelEl.remove();
    });

    this.rooms     = [];
    this.agentObjs = [];
    this.currentRoom = null;
    this.nearDoor    = null;

    this.departments = departments;
    this.agents      = agents;

    this._buildRooms();
    this._buildAgents();
  }

  /** Lock / unlock camera to a fixed overhead view (for non-3D views) */
  setPassive(enabled) {
    if (enabled) {
      // Orbit-ish fixed position
      this.camera.position.set(0, 35, 25);
      this.camera.lookAt(0, 0, 0);
    }
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.renderer.dispose();
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
  }
}

window.World = World;