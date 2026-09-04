/**
 * Camera2D.js
 *
 * Câmera top-down 2D. Sem FPS, sem Pointer Lock, sem raycasting 3D
 * (seção 16 do spec). Suporta:
 *   - pan (arrastar com o mouse / WASD opcional)
 *   - zoom (scroll wheel, focado no cursor)
 *   - centralizar / focar numa sala
 *   - limitar a área de navegação
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  class Camera2D {
    constructor() {
      this.x = 0; // centro da câmera, em coordenadas de mundo
      this.y = 0;
      this.zoom = 1;
      this.minZoom = 0.35;
      this.maxZoom = 2.6;

      // Bounds opcionais (definidos depois que a sala é populada) pra
      // não deixar o usuário se perder fora do escritório.
      this.bounds = null; // { minX, minY, maxX, maxY }

      // Transição suave (fly-to) usada em focusOn/reset.
      this._anim = null;
    }

    setBounds(bounds, padding = 220) {
      if (!bounds) { this.bounds = null; return; }
      this.bounds = {
        minX: bounds.minX - padding,
        minY: bounds.minY - padding,
        maxX: bounds.maxX + padding,
        maxY: bounds.maxY + padding,
      };
    }

    pan(dx, dy) {
      this.x -= dx / this.zoom;
      this.y -= dy / this.zoom;
      this._clamp();
    }

    zoomAt(canvasX, canvasY, canvasW, canvasH, factor) {
      const before = this.screenToWorld(canvasX, canvasY, canvasW, canvasH);
      this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
      const after = this.screenToWorld(canvasX, canvasY, canvasW, canvasH);
      this.x -= after.x - before.x;
      this.y -= after.y - before.y;
      this._clamp();
    }

    _clamp() {
      if (!this.bounds) return;
      this.x = Math.min(this.bounds.maxX, Math.max(this.bounds.minX, this.x));
      this.y = Math.min(this.bounds.maxY, Math.max(this.bounds.minY, this.y));
    }

    /** Anima suavemente até (x,y,zoom) — usado por focusOn/reset. Chamar update() a cada frame. */
    flyTo(x, y, zoom, duration = 0.55) {
      this._anim = {
        fromX: this.x, fromY: this.y, fromZoom: this.zoom,
        toX: x, toY: y, toZoom: zoom,
        t: 0, duration,
      };
    }

    update(delta) {
      if (!this._anim) return;
      const a = this._anim;
      a.t += delta;
      const p = Math.min(1, a.t / a.duration);
      const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
      this.x = a.fromX + (a.toX - a.fromX) * ease;
      this.y = a.fromY + (a.toY - a.fromY) * ease;
      this.zoom = a.fromZoom + (a.toZoom - a.fromZoom) * ease;
      if (p >= 1) this._anim = null;
    }

    focusOnRoom(room, canvasW, canvasH) {
      const targetZoom = Math.min(
        this.maxZoom,
        Math.max(this.minZoom, Math.min(canvasW / (room.width * 1.6), canvasH / (room.height * 1.6)))
      );
      this.flyTo(room.x + room.width / 2, room.y + room.height / 2, targetZoom);
    }

    resetView(worldBoundsCenter, zoom = 1) {
      this.flyTo(worldBoundsCenter.x, worldBoundsCenter.y, zoom, 0.5);
    }

    screenToWorld(sx, sy, canvasW, canvasH) {
      return {
        x: (sx - canvasW / 2) / this.zoom + this.x,
        y: (sy - canvasH / 2) / this.zoom + this.y,
      };
    }

    worldToScreen(wx, wy, canvasW, canvasH) {
      return {
        x: (wx - this.x) * this.zoom + canvasW / 2,
        y: (wy - this.y) * this.zoom + canvasH / 2,
      };
    }

    /** Aplica a transformação da câmera no contexto (chamar antes de desenhar o mundo). */
    applyTransform(ctx, canvasW, canvasH) {
      ctx.translate(canvasW / 2, canvasH / 2);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.x, -this.y);
    }
  }

  NS.Camera2D = Camera2D;
})(typeof window !== 'undefined' ? window : globalThis);