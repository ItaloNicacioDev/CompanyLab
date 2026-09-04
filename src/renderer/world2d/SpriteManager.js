/**
 * SpriteManager.js
 *
 * Gerencia a coleção de AgentSprite (um por agente). API pública
 * pensada pra ser estável independente de sprite real vs. fallback
 * chibi (seção 11 do spec):
 *
 *   createAgentSprite(agent, homePos, room)
 *   setAgentSpriteStatus(agentId, status)
 *   moveAgentSpriteTo(agentId, x, y)
 *   updateAgentSprite(agentId, delta)   // atualiza 1
 *   updateAll(delta, tNow)              // atualiza todos (usado pelo AnimationController)
 *   destroyAgentSprite(agentId)
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  class SpriteManager {
    constructor() {
      /** @type {Map<string, InstanceType<typeof NS.AgentSprite>>} */
      this.sprites = new Map();
    }

    createAgentSprite(agent, homePos, room) {
      const sprite = new NS.AgentSprite(agent, homePos, room);
      this.sprites.set(sprite.id, sprite);
      return sprite;
    }

    get(agentId) {
      return this.sprites.get(agentId) || null;
    }

    all() {
      return Array.from(this.sprites.values());
    }

    setAgentSpriteStatus(agentId, status) {
      const s = this.sprites.get(agentId);
      if (s) s.setStatus(status);
    }

    moveAgentSpriteTo(agentId, x, y) {
      const s = this.sprites.get(agentId);
      if (s) s.moveTo(x, y);
    }

    updateAgentSprite(agentId, delta) {
      const s = this.sprites.get(agentId);
      if (s) s.update(delta, performance.now() / 1000);
    }

    updateAll(delta, tNow) {
      for (const s of this.sprites.values()) s.update(delta, tNow);
    }

    destroyAgentSprite(agentId) {
      this.sprites.delete(agentId);
    }

    clear() {
      this.sprites.clear();
    }

    /** Sincroniza a coleção com uma nova lista de agentes vinda do IPC (populate). */
    sync(agents, homeForAgent, roomForAgent) {
      const seen = new Set();
      for (const agent of agents) {
        seen.add(agent.id);
        const existing = this.sprites.get(agent.id);
        if (existing) {
          existing.updateAgentData(agent);
          existing.homeRoom = roomForAgent(agent) || existing.homeRoom;
        } else {
          const home = homeForAgent(agent);
          const room = roomForAgent(agent);
          this.createAgentSprite(agent, home, room);
        }
      }
      // Remove sprites de agentes que não existem mais (demitidos).
      for (const id of Array.from(this.sprites.keys())) {
        if (!seen.has(id)) this.sprites.delete(id);
      }
    }

    hitTest(wx, wy) {
      // Itera de trás pra frente pra priorizar quem foi desenhado por último (na frente).
      const arr = this.all();
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].containsPoint(wx, wy)) return arr[i];
      }
      return null;
    }
  }

  NS.SpriteManager = SpriteManager;
})(typeof window !== 'undefined' ? window : globalThis);