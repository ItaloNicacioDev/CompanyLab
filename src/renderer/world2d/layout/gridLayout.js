/**
 * layout/gridLayout.js
 *
 * Calcula a disposição espacial das salas a partir da lista real de
 * departamentos (seção 7/29 do spec — nada de departamentos hardcoded).
 * O layout é recalculado sempre que `populate()` roda de novo.
 *
 * Estratégia: uma "praça" central (hub) e as salas dispostas em linhas
 * acima dela, largura variável conforme employeeCount — próximo do
 * diagrama ASCII do spec (departamentos em cima, hub embaixo/no meio).
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  const MIN_ROOM_W = 220;
  const MIN_ROOM_H = 170;
  const GAP = 46;
  const HUB_SIZE = { width: 240, height: 140 };

  /**
   * @param {Array} departments lista real vinda do IPC
   * @returns {{rooms: Array, hub: object, bounds: object}}
   */
  function computeLayout(departments = []) {
    const n = departments.length;

    // Tamanho de cada sala cresce um pouco com o número de funcionários,
    // pra caber as workstations sem apertar.
    const sized = departments.map((dept) => {
      const employeeCount = dept.employeeCount || 0;
      const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(employeeCount || 1))));
      const width = Math.max(MIN_ROOM_W, 90 + cols * 95);
      const height = Math.max(MIN_ROOM_H, 150 + Math.ceil((employeeCount || 1) / cols) * 18);
      return { dept, width, height };
    });

    // Distribui em linhas: tenta manter perto de uma proporção 16:9 no total.
    const perRow = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
    const rows = [];
    for (let i = 0; i < sized.length; i += perRow) {
      rows.push(sized.slice(i, i + perRow));
    }

    const rooms = [];
    let cursorY = 0;
    const rowWidths = [];

    // Linhas de departamentos ficam ACIMA do hub (y negativo), a mais
    // próxima do hub por último, pra combinar com o diagrama do spec.
    for (let r = rows.length - 1; r >= 0; r--) {
      const row = rows[r];
      const rowHeight = Math.max(...row.map((s) => s.height));
      const rowWidth = row.reduce((sum, s) => sum + s.width, 0) + GAP * (row.length - 1);
      rowWidths.push(rowWidth);

      let cursorX = -rowWidth / 2;
      cursorY -= rowHeight + GAP;

      for (const s of row) {
        rooms.push({
          id: s.dept.id,
          name: s.dept.name,
          icon: s.dept.icon || null,
          roomType: s.dept.roomType || 'generic',
          tags: s.dept.tags || [],
          employeeCount: s.dept.employeeCount || 0,
          x: cursorX,
          y: cursorY,
          width: s.width,
          height: s.height,
          accentColor: s.dept.accentColor || null,
        });
        cursorX += s.width + GAP;
      }
    }

    const maxRowWidth = Math.max(HUB_SIZE.width, ...rowWidths, 0);

    const hub = {
      x: -HUB_SIZE.width / 2,
      y: GAP,
      width: HUB_SIZE.width,
      height: HUB_SIZE.height,
    };

    // Ponto de "praça" em frente à porta de cada sala (porta = base da
    // sala, virada pro hub) — usado pelo wandering (AgentSprite) e pela
    // transição de câmera ao clicar na sala.
    rooms.forEach((room) => {
      room.doorX = room.x + room.width / 2;
      room.doorY = room.y + room.height;
      room.plaza = { x: room.doorX, y: room.doorY + 28 };
    });

    const allX = rooms.flatMap((r) => [r.x, r.x + r.width]).concat([hub.x, hub.x + hub.width]);
    const allY = rooms.flatMap((r) => [r.y, r.y + r.height]).concat([hub.y, hub.y + hub.height]);

    const bounds = rooms.length
      ? { minX: Math.min(...allX), minY: Math.min(...allY), maxX: Math.max(...allX), maxY: Math.max(...allY) }
      : { minX: hub.x, minY: hub.y, maxX: hub.x + hub.width, maxY: hub.y + hub.height };

    return { rooms, hub, bounds };
  }

  NS.gridLayout = { computeLayout, MIN_ROOM_W, MIN_ROOM_H, GAP };
})(typeof window !== 'undefined' ? window : globalThis);