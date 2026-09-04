/**
 * InteractionManager.js
 *
 * Toda a entrada do usuário no mundo 2D: clique em agente/sala, hover,
 * pan (arrastar) e zoom (wheel), e WASD opcional pra mover a câmera.
 * Substitui inteiramente o antigo fluxo de Pointer Lock / mouse-look
 * (seção 17 do spec) — não há "modo FPS" pra entrar/sair.
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  const DRAG_THRESHOLD = 5; // px — abaixo disso um mousedown+mouseup conta como "clique", não "pan"
  const WASD_SPEED = 340; // unidades de mundo / segundo

  class InteractionManager {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {InstanceType<typeof NS.Camera2D>} camera
     * @param {object} world referência ao World2D (usa .rooms, .spriteManager, .cb, .isPassive)
     */
    constructor(canvas, camera, world) {
      this.canvas = canvas;
      this.camera = camera;
      this.world = world;

      this.isDragging = false;
      this.dragStart = null;
      this.dragMoved = false;
      this.keys = {};

      this._bind();
    }

    _bind() {
      this.canvas.addEventListener('mousedown', this._onMouseDown = (e) => this._handleMouseDown(e));
      window.addEventListener('mousemove', this._onMouseMove = (e) => this._handleMouseMove(e));
      window.addEventListener('mouseup', this._onMouseUp = (e) => this._handleMouseUp(e));
      this.canvas.addEventListener('wheel', this._onWheel = (e) => this._handleWheel(e), { passive: false });
      this.canvas.addEventListener('mouseleave', this._onLeave = () => this._handleLeave());
      window.addEventListener('keydown', this._onKeyDown = (e) => this._handleKeyDown(e));
      window.addEventListener('keyup', this._onKeyUp = (e) => { this.keys[e.key.toLowerCase()] = false; });
      this.canvas.style.cursor = 'grab';
    }

    destroy() {
      this.canvas.removeEventListener('mousedown', this._onMouseDown);
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('mouseup', this._onMouseUp);
      this.canvas.removeEventListener('wheel', this._onWheel);
      this.canvas.removeEventListener('mouseleave', this._onLeave);
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
    }

    _canvasPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    _handleMouseDown(e) {
      if (this.world.isPassive) return;
      const p = this._canvasPos(e);
      this.isDragging = true;
      this.dragMoved = false;
      this.dragStart = p;
      this.canvas.style.cursor = 'grabbing';
    }

    _handleMouseMove(e) {
      const p = this._canvasPos(e);

      if (this.isDragging && this.dragStart) {
        const dx = p.x - this.dragStart.x;
        const dy = p.y - this.dragStart.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          this.dragMoved = true;
          this.camera.pan(dx, dy);
          this.dragStart = p;
        }
        return;
      }

      if (this.world.isPassive) return;

      // Hover: destaca sprite, mostra nome/status; senão indica sala próxima.
      const world = this.camera.screenToWorld(p.x, p.y, this.canvas.width, this.canvas.height);
      const sprite = this.world.spriteManager.hitTest(world.x, world.y);

      if (this.world._hoveredSprite && this.world._hoveredSprite !== sprite) {
        this.world._hoveredSprite.hovered = false;
      }
      if (sprite) {
        sprite.hovered = true;
        this.world._hoveredSprite = sprite;
        this.world.cb.onPrompt?.(`${sprite.agentData.name} — ${sprite.statusMeta.label}`);
      } else {
        this.world._hoveredSprite = null;
        const room = this._roomAt(world.x, world.y);
        this.world.cb.onPrompt?.(room ? `Clique para entrar em ${room.name}` : null);
      }
    }

    _handleMouseUp(e) {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
      if (this.dragMoved || this.world.isPassive) return; // foi pan, não clique

      const p = this._canvasPos(e);
      const world = this.camera.screenToWorld(p.x, p.y, this.canvas.width, this.canvas.height);

      const sprite = this.world.spriteManager.hitTest(world.x, world.y);
      if (sprite) {
        this.world.selectSprite(sprite);
        this.world.cb.onAgentSelect?.(sprite.agentData);
        return;
      }

      const room = this._roomAt(world.x, world.y);
      if (room) {
        this.world.enterRoom(room);
        return;
      }

      // Clicou em área vazia (fora de qualquer sala) -> volta pro overview.
      this.world.exitRoom();
    }

    _handleLeave() {
      if (this.world._hoveredSprite) {
        this.world._hoveredSprite.hovered = false;
        this.world._hoveredSprite = null;
      }
      this.world.cb.onPrompt?.(null);
    }

    _handleWheel(e) {
      if (this.world.isPassive) return;
      e.preventDefault();
      const p = this._canvasPos(e);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.camera.zoomAt(p.x, p.y, this.canvas.width, this.canvas.height, factor);
    }

    _handleKeyDown(e) {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') this.world.exitRoom();
    }

    _roomAt(wx, wy) {
      const rooms = this.world.rooms;
      for (let i = rooms.length - 1; i >= 0; i--) {
        if (this.world.roomRenderer.containsPoint(rooms[i], wx, wy)) return rooms[i];
      }
      return null;
    }

    /** Chamado a cada frame — move a câmera via WASD, se alguma tecla estiver pressionada. */
    updateWASD(delta) {
      if (this.world.isPassive) return;
      let dx = 0, dy = 0;
      if (this.keys['w'] || this.keys['arrowup']) dy -= 1;
      if (this.keys['s'] || this.keys['arrowdown']) dy += 1;
      if (this.keys['a'] || this.keys['arrowleft']) dx -= 1;
      if (this.keys['d'] || this.keys['arrowright']) dx += 1;
      if (dx === 0 && dy === 0) return;
      const len = Math.hypot(dx, dy) || 1;
      this.camera.x += (dx / len) * WASD_SPEED * delta;
      this.camera.y += (dy / len) * WASD_SPEED * delta;
      this.camera._clamp();
    }
  }

  NS.InteractionManager = InteractionManager;
})(typeof window !== 'undefined' ? window : globalThis);