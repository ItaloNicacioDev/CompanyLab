/**
 * AnimationController.js
 *
 * Loop de atualização por frame (requestAnimationFrame). Calcula o
 * delta time e avança: animação da câmera (flyTo), sprites dos agentes
 * (idle bob, walk, wandering) e pan via WASD. Renderização em si fica
 * a cargo do World2D/RoomRenderer/AgentSprite — este módulo só avança
 * o "tempo" do mundo.
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  class AnimationController {
    constructor(world) {
      this.world = world;
      this._raf = null;
      this._lastT = null;
      this.running = false;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._lastT = performance.now();
      const tick = (now) => {
        if (!this.running) return;
        const delta = Math.min(0.05, (now - this._lastT) / 1000); // clamp evita saltos após tab inativa
        this._lastT = now;
        this._update(delta, now / 1000);
        this.world.render();
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }

    stop() {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
    }

    _update(delta, tNow) {
      this.world.camera.update(delta);
      this.world.interaction?.updateWASD(delta);

      // Quando a view está passiva (usuário em outra aba do app), ainda
      // atualizamos os agentes — mas com um passo maior/menos frequente
      // seria um ganho de performance; por ora mantemos suave já que o
      // canvas nem está visível (rAF de qualquer forma desacelera).
      this.world.spriteManager.updateAll(delta, tNow);
    }
  }

  NS.AnimationController = AnimationController;
})(typeof window !== 'undefined' ? window : globalThis);