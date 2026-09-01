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

        const labelEl = this._makeAgentLabelEl(agent);
        this.labelLayer.appendChild(labelEl);

        this.agentObjs.push({
          group,
          labelEl,
          agentData: agent,
          worldPos:  worldPos.clone(),
          bobPhase:  Math.random() * Math.PI * 2,

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
      furry:     !!cfg.furry,
      furSpecies: cfg.furSpecies || 'fox',
      furColor:  cfg.furColor || '#d97706',
    };
  }

  _makeAgentMesh(agent) {
    const color = STATUS_COLORS[agent.status] ?? STATUS_COLORS.idle;
    const av    = this._parseAvatarConfig(agent);
    const g     = new THREE.Group();
    g.userData.agentId = agent.id;

    // Body — continua tingido pela cor de STATUS (é o indicador real de
    // estado do agente, seção 26/38 do spec: nunca inventar/esconder
    // status). A personalização de aparência (seção "bonecos genéricos")
    // fica em cima disso: pele, cabelo e traços furry.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 1.15, 12),
      new THREE.MeshStandardMaterial({
        color, roughness: 0.45, metalness: 0.35,
        emissive: color, emissiveIntensity: 0.12,
      })
    );
    body.position.y = 0.58;
    body.castShadow = true;
    g.add(body);

    // Head — cor de pele customizável
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 10),
      new THREE.MeshStandardMaterial({ color: av.skinColor, roughness: 0.75 })
    );
    head.position.y = 1.4;
    head.castShadow = true;
    g.add(head);

    this._addHair(g, av);
    if (av.furry) this._addFurryFeatures(g, av);

    // Shadow disc
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    g.add(shadow);

    // Working pulse ring
    if (agent.status === 'working') {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.34, 0.42, 24),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.75,
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      ring.userData.isPulse = true;
      g.add(ring);
    }

    return g;
  }

  /** Adiciona cabelo na cabeça, no estilo escolhido (seção "bonecos genéricos"). */
  _addHair(g, av) {
    if (av.hairStyle === 'bald') return;

    const hairMat = new THREE.MeshStandardMaterial({ color: av.hairColor, roughness: 0.8 });

    if (av.hairStyle === 'short' || av.hairStyle === 'bun') {
      // Touca curta cobrindo o topo da cabeça
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.225, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      cap.position.y = 1.42;
      cap.castShadow = true;
      g.add(cap);

      if (av.hairStyle === 'bun') {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), hairMat);
        bun.position.set(0, 1.62, -0.14);
        g.add(bun);
      }
    } else if (av.hairStyle === 'long') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.225, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      cap.position.y = 1.42;
      g.add(cap);

      // Mecha longa caindo atrás da cabeça
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.42, 10), hairMat);
      strand.position.set(0, 1.22, -0.14);
      strand.castShadow = true;
      g.add(strand);
    } else if (av.hairStyle === 'mohawk') {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.32), hairMat);
      strip.position.y = 1.58;
      strip.castShadow = true;
      g.add(strip);
    }
  }

  /** Adiciona orelhas + rabo de animal quando o agente é "furry" (pedido do usuário). */
  _addFurryFeatures(g, av) {
    const furMat = new THREE.MeshStandardMaterial({ color: av.furColor, roughness: 0.9 });
    const earGeo = av.furSpecies === 'cat' || av.furSpecies === 'fox'
      ? new THREE.ConeGeometry(0.06, 0.14, 8)
      : new THREE.SphereGeometry(0.07, 8, 8); // wolf/rabbit: orelhas mais arredondadas/compridas

    const earL = new THREE.Mesh(earGeo, furMat);
    const earR = new THREE.Mesh(earGeo, furMat);
    const earY = av.furSpecies === 'rabbit' ? 1.66 : 1.56;
    earL.position.set(-0.14, earY, -0.02);
    earR.position.set(0.14, earY, -0.02);
    if (av.furSpecies === 'rabbit') {
      earL.scale.set(0.6, 2.2, 0.6);
      earR.scale.set(0.6, 2.2, 0.6);
    }
    earL.castShadow = earR.castShadow = true;
    g.add(earL, earR);

    // Rabo, saindo da base das costas do corpo
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 8), furMat);
    tail.position.set(0, 0.35, -0.26);
    tail.rotation.x = Math.PI * 0.65;
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
    this._updateAgentAnims(t);
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

  _updateAgentAnims(t) {
    this.agentObjs.forEach(ao => {
      const bob = Math.sin(t * 1.3 + ao.bobPhase) * 0.045;
      ao.group.position.y = ao.worldPos.y + bob;

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
        if (c.geometry) c.geometry.dispose();
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