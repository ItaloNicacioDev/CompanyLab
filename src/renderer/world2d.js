/**
 * World2D.js
 *
 * Motor visual 2D do escritório do CompanyLab — substitui o antigo
 * mundo Three.js/FPS por um Canvas 2D top-down com sprites (seção 1 a
 * 42 do spec de migração). API pública preservada de propósito, pra
 * `renderer.js` não precisar mudar:
 *
 *   new World2D(container, callbacks)
 *   world.populate(departments, agents)
 *   world.setPassive(value)
 *   world.requestEnter()
 *   world.setAgentStatus(agentId, status)
 *   world.destroy()
 *
 * Callbacks aceitos (mesmos nomes de antes):
 *   onAgentSelect(agent) · onPointerLock(locked) · onRoomEnter(deptName)
 *   onRoomExit() · onPrompt(text|null)
 *
 * Nada aqui inventa atividade dos agentes: o único estado "de
 * apresentação" autônomo é o wandering (ver AgentSprite/_updateWander),
 * que nunca sobrescreve `agent.status` — ele só decide se o boneco
 * fica andando por perto enquanto está ocioso (seção 35 do spec).
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  class World2D {
    constructor(container, cb = {}) {
      this.container = container;
      this.cb = cb || {};

      this.departments = [];
      this.agents = [];
      this.rooms = [];
      this.hub = null;

      this.isPassive = false;
      this.currentRoom = null;
      this.selectedSprite = null;
      this._hoveredSprite = null;

      this.assetManager = new NS.AssetManager('assets/');
      this.roomRenderer = new NS.RoomRenderer();
      this.spriteManager = new NS.SpriteManager();
      this.camera = new NS.Camera2D();

      this._initCanvas();
      this.interaction = new NS.InteractionManager(this.canvas, this.camera, this);
      this.animation = new NS.AnimationController(this);
      this.animation.start();

      // Pré-carrega assets reais (se existirem em disco). Não bloqueia —
      // enquanto isso o fallback chibi é usado normalmente.
      this._preloadKnownAssets();
    }

    // ────────────────────────────────────────────────────────────
    // Setup
    // ────────────────────────────────────────────────────────────

    _initCanvas() {
      this.container.innerHTML = '';
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'position:fixed;inset:0;display:block;';
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this._resize();
      window.addEventListener('resize', this._onResize = () => this._resize());
    }

    _resize() {
      const rect = this.container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
      this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this._dpr = dpr;
    }

    _preloadKnownAssets() {
      const species = ['fox', 'wolf', 'cat', 'rabbit'];
      const frames = ['idle', 'walk_down', 'walk_up', 'walk_left', 'walk_right', 'work'];
      const entries = [];
      frames.forEach((f) => entries.push({ key: `agents/sprites/human/${f}`, path: `agents/sprites/human/${f}.png` }));
      species.forEach((sp) => {
        frames.forEach((f) => entries.push({ key: `agents/sprites/furry/${sp}/${f}`, path: `agents/sprites/furry/${sp}/${f}.png` }));
      });
      this.assetManager.preload(entries);
    }

    // ────────────────────────────────────────────────────────────
    // API pública compatível
    // ────────────────────────────────────────────────────────────

    populate(departments, agents) {
      this.departments = departments || [];
      this.agents = agents || [];

      const { rooms, hub, bounds } = NS.gridLayout.computeLayout(this.departments);
      this.rooms = rooms;
      this.hub = hub;

      // Slots de workstation por sala (recalculado a cada populate, já
      // que employeeCount pode ter mudado).
      this.rooms.forEach((room) => {
        room.workstations = this.roomRenderer.layoutWorkstations(room);
      });

      const byDept = new Map();
      this.agents.forEach((agent) => {
        const key = agent.departmentId || '__none__';
        if (!byDept.has(key)) byDept.set(key, []);
        byDept.get(key).push(agent);
      });

      const slotIndexByDept = new Map();
      const homeForAgent = (agent) => {
        const room = this.rooms.find((r) => r.id === agent.departmentId);
        if (!room || !room.workstations.length) {
          return { x: this.hub.x + this.hub.width / 2, y: this.hub.y + this.hub.height / 2 };
        }
        const i = slotIndexByDept.get(agent.departmentId) || 0;
        slotIndexByDept.set(agent.departmentId, i + 1);
        return room.workstations[i % room.workstations.length];
      };
      const roomForAgent = (agent) => this.rooms.find((r) => r.id === agent.departmentId) || null;

      this.spriteManager.sync(this.agents, homeForAgent, roomForAgent);

      this.camera.setBounds(bounds);
      if (!this._everPopulated) {
        this._everPopulated = true;
        this._fitOverview(true);
      }
    }

    _fitOverview(instant) {
      const b = this.camera.bounds;
      if (!b) return;
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const w = (b.maxX - b.minX) || 800;
      const h = (b.maxY - b.minY) || 600;
      const rect = this.container.getBoundingClientRect();
      const zoom = Math.min(this.camera.maxZoom, Math.max(this.camera.minZoom,
        Math.min((rect.width || 1200) / w, (rect.height || 800) / h) * 0.92));
      if (instant) {
        this.camera.x = cx; this.camera.y = cy; this.camera.zoom = zoom;
      } else {
        this.camera.flyTo(cx, cy, zoom, 0.6);
      }
    }

    setPassive(value) {
      this.isPassive = !!value;
      const app = document.getElementById('app');
      if (app) app.classList.toggle('app-passive', this.isPassive);
      this.cb.onPointerLock?.(!this.isPassive);
    }

    requestEnter() {
      this.setPassive(false);
      this.cb.onPointerLock?.(true);
      this.cb.onPrompt?.(null);
    }

    setAgentStatus(agentId, status) {
      this.spriteManager.setAgentSpriteStatus(agentId, status);
    }

    moveAgentSpriteTo(agentId, x, y) {
      this.spriteManager.moveAgentSpriteTo(agentId, x, y);
    }

    destroy() {
      this.animation?.stop();
      this.interaction?.destroy();
      if (this._onResize) window.removeEventListener('resize', this._onResize);
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }

    // ────────────────────────────────────────────────────────────
    // Interação de alto nível (chamado pelo InteractionManager)
    // ────────────────────────────────────────────────────────────

    selectSprite(sprite) {
      if (this.selectedSprite && this.selectedSprite !== sprite) this.selectedSprite.selected = false;
      this.selectedSprite = sprite;
      if (sprite) sprite.selected = true;
    }

    enterRoom(room) {
      this.currentRoom = room;
      this.camera.focusOnRoom(room, this.canvas.width / this._dpr, this.canvas.height / this._dpr);
      this.cb.onRoomEnter?.(room.name);
    }

    exitRoom() {
      const wasSelected = this.selectedSprite;
      if (wasSelected) { wasSelected.selected = false; this.selectedSprite = null; }
      if (!this.currentRoom) return;
      this.currentRoom = null;
      this._fitOverview(false);
      this.cb.onRoomExit?.();
    }

    // ────────────────────────────────────────────────────────────
    // Render
    // ────────────────────────────────────────────────────────────

    render() {
      const ctx = this.ctx;
      const w = this.canvas.width, h = this.canvas.height;

      ctx.save();
      ctx.scale(this._dpr, this._dpr);
      const cw = w / this._dpr, ch = h / this._dpr;

      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, 0, cw, ch);

      ctx.save();
      this.camera.applyTransform(ctx, cw, ch);

      this._drawBackgroundGrid(ctx);

      if (this.hub) this.roomRenderer.drawHub(ctx, this.hub);
      this.rooms.forEach((room, i) => this.roomRenderer.draw(ctx, room, i));

      const sprites = this.spriteManager.all().sort((a, b) => a.y - b.y);
      sprites.forEach((s) => s.draw(ctx, this.assetManager));

      ctx.restore();
      ctx.restore();
    }

    _drawBackgroundGrid(ctx) {
      const b = this.camera.bounds;
      if (!b) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.05)';
      ctx.lineWidth = 1;
      const step = 80;
      const pad = 400;
      for (let x = b.minX - pad; x <= b.maxX + pad; x += step) {
        ctx.beginPath(); ctx.moveTo(x, b.minY - pad); ctx.lineTo(x, b.maxY + pad); ctx.stroke();
      }
      for (let y = b.minY - pad; y <= b.maxY + pad; y += step) {
        ctx.beginPath(); ctx.moveTo(b.minX - pad, y); ctx.lineTo(b.maxX + pad, y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  NS.World2D = World2D;
  // Compatibilidade: renderer.js instancia via window.World2D (seção 26 do spec).
  root.World2D = World2D;
  if (typeof module !== 'undefined' && module.exports) module.exports = { World2D };
})(typeof window !== 'undefined' ? window : globalThis);