/**
 * AgentSprite.js
 *
 * Representa visualmente UM agente no mundo 2D: posição, direção,
 * animação, sprite/fallback, nome, status, seleção e movimento.
 *
 * Não decide *quando* um agente entra em `working`/`meeting`/etc — isso
 * vem sempre de `agent.status` (dado real) ou de eventos reais do
 * EventBus, repassados pelo SpriteManager (seção 12/35 do spec).
 * O que existe aqui de "autônomo" é só o wandering visual (seção 15),
 * que é comportamento de apresentação, não de execução.
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  const STATUS_META = {
    idle:          { color: '#64748b', icon: '', label: 'Ocioso' },
    working:       { color: '#22c55e', icon: '⚙',  label: 'Trabalhando' },
    communicating: { color: '#3b82f6', icon: '💬', label: 'Comunicando' },
    meeting:       { color: '#8b5cf6', icon: '👥', label: 'Reunião' },
    waiting:       { color: '#f59e0b', icon: '⏳', label: 'Aguardando' },
    blocked:       { color: '#ef4444', icon: '⛔', label: 'Bloqueado' },
    error:         { color: '#dc2626', icon: '⚠',  label: 'Erro' },
    completed:     { color: '#06b6d4', icon: '✓',  label: 'Concluído' },
  };

  const SPRITE_SIZE = 34; // altura aproximada em unidades de mundo (bounding box de interação)

  let _uid = 0;

  class AgentSprite {
    /**
     * @param {object} agent dado real do agente (id, name, avatar, status, departmentId, ...)
     * @param {{x:number,y:number}} homePos posição "de casa" (workstation) em coordenadas de mundo
     * @param {object} [room] sala/departamento a que pertence (usada pro wandering)
     */
    constructor(agent, homePos, room) {
      this.id = agent.id || `sprite_${_uid++}`;
      this.agentData = agent;
      this.status = agent.status || 'idle';

      this.x = homePos.x;
      this.y = homePos.y;
      this.homeX = homePos.x;
      this.homeY = homePos.y;
      this.homeRoom = room || null;

      this.direction = 'down'; // 'down' | 'up' | 'left' | 'right'
      this.walkPhase = Math.random();
      this.idlePhase = Math.random() * Math.PI * 2;
      this.workPhase = Math.random() * Math.PI * 2;
      this.moving = false;

      this.selected = false;
      this.hovered = false;

      // Alvo de movimento explícito (ex: moveAgentSpriteTo) tem prioridade
      // sobre o wandering espontâneo.
      this.target = null;
      this.speed = 42; // unidades de mundo / segundo

      // Wandering — mesmo conceito/campos do mundo 3D anterior, só que
      // em coordenadas x/y ao invés de x/z (seção 15 do spec).
      this.wander = {
        state: 'idle', // 'idle' | 'walking' | 'pausing'
        nextWanderAt: performance.now() / 1000 + 6 + Math.random() * 18,
        path: [],
        pathIndex: 0,
        returning: false,
        pauseUntil: 0,
        speed: 30 + Math.random() * 14,
      };

      this.avatar = this._parseAvatar(agent);
    }

    _parseAvatar(agent) {
      let cfg = {};
      if (agent.avatar) {
        try { cfg = JSON.parse(agent.avatar); } catch { cfg = {}; }
      }
      return {
        skinColor: cfg.skinColor || '#f1c27d',
        hairColor: cfg.hairColor || '#2d1b0e',
        hairStyle: cfg.hairStyle || 'short',
        outfitColor: cfg.outfitColor || '#3b82f6',
        furry: !!cfg.furry,
        furSpecies: cfg.furSpecies || 'fox',
        furColor: cfg.furColor || '#d97706',
      };
    }

    /** Atualiza o dado real do agente (chamado quando `agent:getAll` refaz o polling). */
    updateAgentData(agent) {
      this.agentData = agent;
      if (agent.status && agent.status !== this.status) this.setStatus(agent.status);
      this.avatar = this._parseAvatar(agent);
    }

    setStatus(status) {
      this.status = status || 'idle';
    }

    /** Move explicitamente para (x,y) — cancela wandering em progresso. */
    moveTo(x, y) {
      this.target = { x, y };
      this.wander.state = 'idle';
      this.wander.path = [];
    }

    get statusMeta() {
      return STATUS_META[this.status] || STATUS_META.idle;
    }

    /** Bounding box (mundo) usado pra hit-test de clique/hover. */
    getBounds() {
      const w = SPRITE_SIZE * 0.6;
      const h = SPRITE_SIZE;
      return { x: this.x - w / 2, y: this.y - h * 0.75, width: w, height: h };
    }

    containsPoint(wx, wy) {
      const dx = wx - this.x;
      const dy = wy - (this.y - SPRITE_SIZE * 0.35);
      const rx = SPRITE_SIZE * 0.45;
      const ry = SPRITE_SIZE * 0.55;
      return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
    }

    // ────────────────────────────────────────────────────────────
    // Update (chamado a cada frame pelo AnimationController)
    // ────────────────────────────────────────────────────────────

    update(delta, tNow) {
      this.idlePhase += delta * 2.2;
      this.workPhase += delta * 3.4;

      if (this.target) {
        this._stepToward(this.target, delta);
        if (this._distTo(this.target) < 1) this.target = null;
      } else {
        this._updateWander(delta, tNow);
      }

      if (this.moving) {
        this.walkPhase = (this.walkPhase + delta * 3.2) % 1;
      }
    }

    _distTo(p) {
      return Math.hypot(p.x - this.x, p.y - this.y);
    }

    _stepToward(p, delta) {
      const dx = p.x - this.x;
      const dy = p.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.5) { this.moving = false; return; }
      this.moving = true;
      this._faceDirection(dx, dy);
      const step = Math.min(dist, this.speed * delta);
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }

    _faceDirection(dx, dy) {
      if (Math.abs(dx) > Math.abs(dy)) {
        this.direction = dx > 0 ? 'right' : 'left';
      } else {
        this.direction = dy > 0 ? 'down' : 'up';
      }
    }

    // ── Wandering: comportamento visual, nunca decide status real ──
    _updateWander(delta, tNow) {
      const w = this.wander;

      // Agentes bloqueados/com erro ficam parados na mesa — sumir seria
      // enganoso justamente quando o usuário mais precisa perceber o problema.
      if (this.status === 'blocked' || this.status === 'error') {
        this.moving = false;
        w.state = 'idle';
        w.nextWanderAt = tNow + 8;
        return;
      }
      // Enquanto está de fato trabalhando/reunião/comunicando, fica na mesa.
      if (this.status === 'working' || this.status === 'meeting' || this.status === 'communicating') {
        this.moving = false;
        w.state = 'idle';
        w.nextWanderAt = tNow + 6;
        return;
      }

      if (w.state === 'idle') {
        this.moving = false;
        if (tNow < w.nextWanderAt) return;
        this._startWander(tNow);
        return;
      }

      if (w.state === 'pausing') {
        this.moving = false;
        if (tNow >= w.pauseUntil) {
          w.path = [...w.path].reverse();
          w.pathIndex = 0;
          w.returning = true;
          w.state = 'walking';
        }
        return;
      }

      if (w.state === 'walking') {
        const p = w.path[w.pathIndex];
        if (!p) { w.state = 'idle'; this.moving = false; return; }
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          w.pathIndex++;
          if (w.pathIndex >= w.path.length) {
            if (w.returning) {
              w.state = 'idle';
              w.returning = false;
              w.nextWanderAt = tNow + 15 + Math.random() * 30;
            } else {
              w.state = 'pausing';
              w.pauseUntil = tNow + 4 + Math.random() * 10;
            }
          }
          return;
        }
        this.moving = true;
        this._faceDirection(dx, dy);
        const step = Math.min(dist, w.speed * delta);
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
      }
    }

    _startWander(tNow) {
      const w = this.wander;
      const room = this.homeRoom;
      if (!room) return;
      // Pequeno passeio dentro/perto da própria sala (o RoomRenderer expõe
      // um ponto de "praça" em frente à porta via room.plaza).
      const plaza = room.plaza || { x: this.homeX, y: this.homeY - 20 };
      const spot = {
        x: room.x + room.width / 2 + (Math.random() - 0.5) * room.width * 0.5,
        y: room.y + room.height / 2 + (Math.random() - 0.5) * room.height * 0.3,
      };
      w.path = Math.random() < 0.6 ? [plaza] : [plaza, spot];
      w.pathIndex = 0;
      w.returning = false;
      w.state = 'walking';
    }

    // ────────────────────────────────────────────────────────────
    // Draw
    // ────────────────────────────────────────────────────────────

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {object} assetManager AssetManager instance (sprites reais, se existirem)
     */
    draw(ctx, assetManager) {
      const idleBob = this.moving ? 0 : Math.sin(this.idlePhase) * 1.1;
      const walkBob = this.moving ? Math.abs(Math.sin(this.walkPhase * Math.PI * 2)) * -2 : 0;

      ctx.save();
      ctx.translate(this.x, this.y);

      if (this.hovered || this.selected) {
        ctx.save();
        ctx.globalAlpha = this.selected ? 0.35 : 0.2;
        ctx.beginPath();
        ctx.ellipse(0, -8, 15, 18, 0, 0, Math.PI * 2);
        ctx.fillStyle = this.selected ? '#fbbf24' : '#93c5fd';
        ctx.fill();
        ctx.restore();
      }

      const spriteImg = this._resolveSpriteImage(assetManager);
      if (spriteImg) {
        // Sprite real disponível: desenha o frame direto (sprite sheet ou PNG único).
        const w = 28, h = 34;
        ctx.drawImage(spriteImg, -w / 2, -h + 6 + idleBob + walkBob, w, h);
      } else {
        const pose = {
          direction: this.direction,
          walkPhase: this.moving ? this.walkPhase : 0,
          bob: idleBob + walkBob,
          working: this.status === 'working',
          workPhase: this.workPhase,
        };
        NS.ChibiRenderer.drawChibi(ctx, this.avatar, pose);
      }

      ctx.restore();

      this._drawStatusBadge(ctx, idleBob + walkBob);
      this._drawLabel(ctx, idleBob + walkBob);
      this._drawStatusEffect(ctx, idleBob + walkBob);
    }

    _resolveSpriteImage(assetManager) {
      if (!assetManager) return null;
      const base = this.avatar.furry ? `agents/sprites/furry/${this.avatar.furSpecies}` : 'agents/sprites/human';
      const frame = this.status === 'working' ? 'work' : (this.moving ? `walk_${this.direction}` : 'idle');
      return assetManager.get(`${base}/${frame}`, `${base}/${frame}.png`);
    }

    _drawStatusBadge(ctx, bob) {
      const meta = this.statusMeta;
      const bx = this.x + 9;
      const by = this.y - 30 + bob;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = meta.color;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(15,23,42,0.85)';
      ctx.stroke();
      if (this.status === 'working') {
        // pequeno "pulso" de atividade
        ctx.globalAlpha = 0.5 + Math.sin(this.workPhase) * 0.3;
        ctx.beginPath();
        ctx.arc(bx, by, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawStatusEffect(ctx, bob) {
      // Pequenos indicadores contextuais acima da cabeça (balão de fala,
      // "..." de espera, efeito de conclusão) — discretos, não substituem
      // o badge de status.
      const cx = this.x;
      const cy = this.y - 46 + bob;
      ctx.save();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (this.status === 'communicating') {
        ctx.globalAlpha = 0.55 + Math.sin(this.idlePhase * 2) * 0.25;
        ctx.fillText('💬', cx, cy);
      } else if (this.status === 'waiting') {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#f59e0b';
        ctx.fillText('⋯', cx, cy);
      } else if (this.status === 'blocked' || this.status === 'error') {
        ctx.globalAlpha = 0.85;
        ctx.fillText(this.status === 'error' ? '⚠' : '⛔', cx, cy);
      } else if (this.status === 'completed') {
        ctx.globalAlpha = Math.max(0, 1 - (performance.now() / 1000 % 3) / 3);
        ctx.fillStyle = '#06b6d4';
        ctx.fillText('✓', cx, cy);
      }
      ctx.restore();
    }

    _drawLabel(ctx, bob) {
      const name = this.agentData.name || '—';
      const y = this.y + 8 + bob;
      ctx.save();
      ctx.font = this.selected ? 'bold 11px Inter, system-ui, sans-serif' : '10px Inter, system-ui, sans-serif';
      const paddingX = 6;
      const textW = ctx.measureText(name).width;
      const boxW = textW + paddingX * 2;
      const boxH = 15;

      ctx.fillStyle = this.hovered || this.selected ? 'rgba(15,23,42,0.92)' : 'rgba(15,23,42,0.68)';
      NS.ChibiRenderer.roundRect(ctx, this.x - boxW / 2, y, boxW, boxH, 5);
      ctx.fill();

      if (this.homeRoom && this.homeRoom.accentColor) {
        ctx.strokeStyle = this.homeRoom.accentColor;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, this.x, y + boxH / 2 + 0.5);
      ctx.restore();
    }
  }

  NS.AgentSprite = AgentSprite;
  NS.STATUS_META = STATUS_META;
  NS.SPRITE_SIZE = SPRITE_SIZE;
})(typeof window !== 'undefined' ? window : globalThis);