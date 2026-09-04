/**
 * RoomRenderer.js
 *
 * Desenha cada sala (piso, paredes, porta, móveis, decoração,
 * identificação) e o hub central em Canvas 2D. A resolução de "que
 * tipo de sala é essa" continua vindo do dado real do departamento
 * (`roomType`/`tags`), igual ao antigo `RoomFactory`/`roomTemplates`
 * (seção 27/28/31 do spec) — aqui só muda a representação, que passa
 * a ser um conjunto de descritores 2D em vez de THREE.Group.
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  const DEPT_PALETTE = [
    '#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b',
    '#ec4899', '#06b6d4', '#84cc16', '#f43f5e',
  ];

  function shade(hex, amt) {
    return NS.ChibiRenderer.shade(hex, amt);
  }

  function roundRect(ctx, x, y, w, h, r) {
    NS.ChibiRenderer.roundRect(ctx, x, y, w, h, r);
  }

  // ── Móveis procedurais reutilizáveis ────────────────────────────

  function drawDesk(ctx, x, y, w, h, accent) {
    ctx.save();
    ctx.translate(x, y);
    // sombra
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    roundRect(ctx, -w / 2 + 2, -h / 2 + 3, w, h, 4);
    ctx.fill();
    // tampo
    ctx.fillStyle = '#8a5a34';
    roundRect(ctx, -w / 2, -h / 2, w, h, 4);
    ctx.fill();
    ctx.fillStyle = shade('#8a5a34', 0.18);
    roundRect(ctx, -w / 2, -h / 2, w, h * 0.35, 3);
    ctx.fill();
    ctx.restore();
  }

  function drawChair(ctx, x, y, accent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = shade(accent, -0.1);
    roundRect(ctx, -6, -6, 12, 12, 3);
    ctx.fill();
    ctx.fillStyle = shade(accent, -0.35);
    roundRect(ctx, -6, -9, 12, 4, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMonitor(ctx, x, y, glow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#1e293b';
    roundRect(ctx, -8, -7, 16, 11, 2);
    ctx.fill();
    ctx.fillStyle = glow ? '#5eead4' : '#334155';
    roundRect(ctx, -6.5, -5.5, 13, 8, 1.4);
    ctx.fill();
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-2, 4, 4, 3);
    ctx.restore();
  }

  function drawWorkstation(ctx, x, y, accent, glow) {
    drawDesk(ctx, x, y, 34, 20, accent);
    drawMonitor(ctx, x, y - 3, glow);
    drawChair(ctx, x, y + 16, accent);
  }

  function drawPlant(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(0, 8, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7c5232';
    roundRect(ctx, -6, 0, 12, 8, 2);
    ctx.fill();
    ctx.fillStyle = '#2f9e5b';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 5, -6 + Math.sin(a) * 5, 5, 8, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#3fbd73';
    ctx.beginPath(); ctx.ellipse(0, -12, 4.5, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawServerRack(ctx, x, y, active) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#0f172a';
    roundRect(ctx, -10, -18, 20, 36, 2);
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      ctx.strokeRect(-8, -15 + i * 5.6, 16, 4.2);
      ctx.fillStyle = active ? (i % 2 === 0 ? '#22c55e' : '#5eead4') : '#334155';
      ctx.beginPath();
      ctx.arc(6, -13 + i * 5.6, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawWhiteboard(ctx, x, y, w) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#e2e8f0';
    roundRect(ctx, -w / 2, -14, w, 22, 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-w / 2, -14, w, 22);
    ctx.strokeStyle = '#60a5fa';
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 6, -6); ctx.lineTo(-w / 2 + w * 0.4, -6);
    ctx.moveTo(-w / 2 + 6, 0); ctx.lineTo(-w / 2 + w * 0.6, 0);
    ctx.moveTo(-w / 2 + 6, 6); ctx.lineTo(-w / 2 + w * 0.3, 6);
    ctx.stroke();
    ctx.restore();
  }

  function drawFilingCabinet(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#94a3b8';
    roundRect(ctx, -9, -16, 18, 32, 2);
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    for (let i = 0; i < 3; i++) {
      ctx.strokeRect(-7, -13 + i * 10, 14, 8);
      ctx.fillStyle = '#475569';
      ctx.fillRect(2, -10 + i * 10, 3, 1.6);
    }
    ctx.restore();
  }

  function drawChart(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, -14, -12, 28, 20, 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(-14, -12, 28, 20);
    const bars = [4, 9, 6, 11];
    ctx.fillStyle = '#22c55e';
    bars.forEach((b, i) => {
      ctx.fillRect(-11 + i * 7, 6 - b, 4.5, b);
    });
    ctx.restore();
  }

  function drawPosterBoard(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#fef3c7';
    roundRect(ctx, -11, -14, 22, 28, 2);
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-11, -14, 22, 28);
    ctx.fillStyle = '#ec4899';
    ctx.fillRect(-7, -9, 14, 3);
    ctx.fillStyle = '#8b5cf6';
    ctx.fillRect(-7, -3, 10, 3);
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(-7, 3, 12, 3);
    ctx.restore();
  }

  function drawWaterCooler(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#bae6fd';
    ctx.beginPath();
    ctx.ellipse(0, -14, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    roundRect(ctx, -5, -6, 10, 18, 2);
    ctx.fill();
    ctx.restore();
  }

  const FURNITURE_DRAW = {
    plant: drawPlant,
    serverRack: drawServerRack,
    whiteboard: drawWhiteboard,
    filingCabinet: drawFilingCabinet,
    chart: drawChart,
    posterBoard: drawPosterBoard,
    waterCooler: drawWaterCooler,
  };

  // ── Descritores de decoração por tipo de sala (seção 28/31) ────
  // Cada função recebe (ctx, room, accent) e desenha itens de apoio,
  // além das workstations (que são geradas dinamicamente conforme
  // employeeCount em `layoutWorkstations`).
  const ROOM_DECOR = {
    development(ctx, room, accent) {
      drawServerRack(ctx, room.x + room.width - 26, room.y + 34, true);
      drawWhiteboard(ctx, room.x + room.width / 2, room.y + 22, Math.min(90, room.width * 0.45));
      drawPlant(ctx, room.x + 22, room.y + room.height - 26);
    },
    marketing(ctx, room, accent) {
      drawPosterBoard(ctx, room.x + room.width - 24, room.y + 40);
      drawChart(ctx, room.x + 24, room.y + 30);
      drawPlant(ctx, room.x + room.width - 22, room.y + room.height - 26);
    },
    finance(ctx, room, accent) {
      drawFilingCabinet(ctx, room.x + room.width - 22, room.y + 36);
      drawChart(ctx, room.x + 24, room.y + 28);
      drawPlant(ctx, room.x + 22, room.y + room.height - 26);
    },
    generic(ctx, room, accent) {
      drawPlant(ctx, room.x + 22, room.y + 28);
      drawWaterCooler(ctx, room.x + room.width - 20, room.y + 30);
    },
  };

  function resolveRoomType(room) {
    const t = (room.roomType || '').toLowerCase();
    if (ROOM_DECOR[t]) return t;
    const tags = (room.tags || []).map((s) => String(s).toLowerCase());
    if (tags.some((t2) => ['code', 'dev', 'engineering', 'software'].includes(t2))) return 'development';
    if (tags.some((t2) => ['ads', 'brand', 'growth', 'social'].includes(t2))) return 'marketing';
    if (tags.some((t2) => ['money', 'budget', 'accounting'].includes(t2))) return 'finance';
    return 'generic';
  }

  class RoomRenderer {
    constructor() {
      this.floorPatternCache = new Map();
    }

    colorFor(room, index) {
      return room.accentColor || DEPT_PALETTE[index % DEPT_PALETTE.length];
    }

    /** Calcula as posições de workstation (mesa/cadeira) dentro da sala. */
    layoutWorkstations(room) {
      const count = Math.max(room.employeeCount || 0, 1);
      const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(count))));
      const rows = Math.ceil(count / cols);
      const marginTop = 58;
      const marginBottom = 30;
      const marginX = 30;
      const usableW = room.width - marginX * 2;
      const usableH = room.height - marginTop - marginBottom;
      const cellW = usableW / cols;
      const cellH = usableH / Math.max(rows, 1);

      const slots = [];
      for (let i = 0; i < count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        slots.push({
          x: room.x + marginX + cellW * (c + 0.5),
          y: room.y + marginTop + cellH * (r + 0.5),
        });
      }
      return slots;
    }

    draw(ctx, room, index) {
      const accent = this.colorFor(room, index);
      const type = resolveRoomType(room);

      this._drawFloor(ctx, room, accent);
      this._drawWalls(ctx, room, accent);

      const decorFn = ROOM_DECOR[type] || ROOM_DECOR.generic;
      decorFn(ctx, room, accent);

      const slots = this.layoutWorkstations(room);
      slots.forEach((s) => drawWorkstation(ctx, s.x, s.y, accent, type === 'development'));

      this._drawDoor(ctx, room, accent);
      this._drawLabel(ctx, room, accent, type);
    }

    _drawFloor(ctx, room, accent) {
      ctx.save();
      ctx.fillStyle = '#131c2e';
      roundRect(ctx, room.x, room.y, room.width, room.height, 10);
      ctx.fill();

      // padrão de piso em tiles sutis
      ctx.save();
      roundRect(ctx, room.x, room.y, room.width, room.height, 10);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      const tile = 24;
      for (let gx = room.x; gx < room.x + room.width; gx += tile) {
        ctx.beginPath(); ctx.moveTo(gx, room.y); ctx.lineTo(gx, room.y + room.height); ctx.stroke();
      }
      for (let gy = room.y; gy < room.y + room.height; gy += tile) {
        ctx.beginPath(); ctx.moveTo(room.x, gy); ctx.lineTo(room.x + room.width, gy); ctx.stroke();
      }
      // leve tingimento com a cor de destaque do departamento
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.05;
      ctx.fillRect(room.x, room.y, room.width, room.height);
      ctx.restore();

      ctx.restore();
    }

    _drawWalls(ctx, room, accent) {
      ctx.save();
      ctx.lineWidth = 4;
      ctx.strokeStyle = shade(accent, -0.35);
      roundRect(ctx, room.x, room.y, room.width, room.height, 10);
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.75;
      roundRect(ctx, room.x + 2.5, room.y + 2.5, room.width - 5, room.height - 5, 8);
      ctx.stroke();
      ctx.restore();
    }

    _drawDoor(ctx, room, accent) {
      const doorW = 34;
      ctx.save();
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(room.doorX - doorW / 2, room.y + room.height - 3, doorW, 6);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(room.doorX - doorW / 2, room.y + room.height);
      ctx.lineTo(room.doorX + doorW / 2, room.y + room.height);
      ctx.stroke();
      // pequenas marcas de "entrada" (tapete)
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.ellipse(room.doorX, room.y + room.height + 8, doorW * 0.7, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawLabel(ctx, room, accent, type) {
      const cx = room.x + room.width / 2;
      const y = room.y - 12;
      ctx.save();
      ctx.font = 'bold 13px Inter, system-ui, sans-serif';
      const text = room.name.toUpperCase();
      const textW = ctx.measureText(text).width;
      const boxW = textW + 26;
      ctx.fillStyle = 'rgba(11,17,32,0.85)';
      roundRect(ctx, cx - boxW / 2, y - 20, boxW, 24, 7);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      roundRect(ctx, cx - boxW / 2, y - 20, boxW, 24, 7);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx - boxW / 2 + 13, y - 8, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx - boxW / 2 + 22, y - 7.5);
      ctx.restore();
    }

    drawHub(ctx, hub) {
      ctx.save();
      ctx.fillStyle = 'rgba(148,163,184,0.06)';
      roundRect(ctx, hub.x, hub.y, hub.width, hub.height, 22);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.4;
      roundRect(ctx, hub.x, hub.y, hub.width, hub.height, 22);
      ctx.stroke();
      ctx.setLineDash([]);

      // um pequeno tapete/plaza central + bancos
      const cx = hub.x + hub.width / 2;
      const cy = hub.y + hub.height / 2;
      drawWaterCooler(ctx, cx - hub.width / 2 + 26, cy);
      drawPlant(ctx, cx + hub.width / 2 - 24, cy);

      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(226,232,240,0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CENTRAL HUB', cx, cy);
      ctx.restore();
    }

    containsPoint(room, wx, wy) {
      return wx >= room.x && wx <= room.x + room.width && wy >= room.y && wy <= room.y + room.height;
    }
  }

  NS.RoomRenderer = RoomRenderer;
  NS.DEPT_PALETTE = DEPT_PALETTE;
  NS.resolveRoomType = resolveRoomType;
})(typeof window !== 'undefined' ? window : globalThis);