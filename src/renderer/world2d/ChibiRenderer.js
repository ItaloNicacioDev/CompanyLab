/**
 * ChibiRenderer.js
 *
 * Desenho procedural de personagens estilo "chibi" em Canvas 2D.
 * É o fallback visual usado pelo AgentSprite quando não existe (ainda)
 * um sprite sheet real em assets/agents/sprites/**. Também é usado
 * como a "arte" padrão do projeto, já que nenhum PNG precisa existir
 * pra o mundo ficar bonito (seção 36 do spec: fallback tem que ser
 * visualmente agradável, nunca um boneco de quadrados).
 *
 * Interpreta as mesmas propriedades de customização já usadas pelo
 * avatar builder existente (seção 10 do spec):
 *   skinColor, hairColor, hairStyle, outfitColor
 *   furry, furSpecies, furColor
 *
 * Tudo é desenhado centrado em (0,0), "de pé" olhando pra baixo (south),
 * numa caixa de ~32x40 unidades — quem chama aplica translate/scale/rotate.
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  const FUR_PRESETS = {
    fox:    { ear: 'pointed', earColor: '#e8752c', tail: 'bushy' },
    wolf:   { ear: 'pointed', earColor: '#8b8f99', tail: 'straight' },
    cat:    { ear: 'round-tip', earColor: null, tail: 'thin' },
    rabbit: { ear: 'long', earColor: '#f4c9d6', tail: 'puff' },
    deer:   { ear: 'round-tip', earColor: null, tail: 'short' },
    bear:   { ear: 'round', earColor: null, tail: 'short' },
    dog:    { ear: 'floppy', earColor: null, tail: 'wag' },
    dragon: { ear: 'horned', earColor: '#3ea36b', tail: 'spiked' },
  };

  function shade(hex, amt) {
    // amt < 0 escurece, amt > 0 clareia
    const c = hex.replace('#', '');
    const num = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16);
    let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
    if (amt < 0) {
      r = Math.round(r * (1 + amt));
      g = Math.round(g * (1 + amt));
      b = Math.round(b * (1 + amt));
    } else {
      r = Math.round(r + (255 - r) * amt);
      g = Math.round(g + (255 - g) * amt);
      b = Math.round(b + (255 - b) * amt);
    }
    return `rgb(${Math.max(0, Math.min(255, r))},${Math.max(0, Math.min(255, g))},${Math.max(0, Math.min(255, b))})`;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} av avatar config (skinColor, hairColor, hairStyle, outfitColor, furry, furSpecies, furColor)
   * @param {object} pose { direction: 'down'|'up'|'left'|'right', walkPhase: 0..1, bob: number, working: boolean }
   */
  function drawChibi(ctx, av, pose = {}) {
    const direction = pose.direction || 'down';
    const walk = pose.walkPhase || 0; // 0..1 ciclo de passo
    const bob = pose.bob || 0; // deslocamento vertical (idle bob / passo)
    const facingLeft = direction === 'left';
    const facingSide = direction === 'left' || direction === 'right';
    const facingUp = direction === 'up';

    const skin = av.skinColor || '#f1c27d';
    const hair = av.hairColor || '#2d1b0e';
    const outfit = av.outfitColor || '#3b82f6';
    const isFurry = !!av.furry;
    const furColor = av.furColor || '#d97706';
    const fur = FUR_PRESETS[av.furSpecies] || FUR_PRESETS.fox;
    const bodyBase = isFurry ? furColor : skin;

    ctx.save();
    if (facingLeft) ctx.scale(-1, 1); // reaproveita o desenho "right" espelhado

    ctx.translate(0, bob);

    // ── sombra no chão ──────────────────────────────────────────
    ctx.save();
    ctx.translate(0, 15);
    ctx.scale(1, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.restore();

    // ── pernas (alternam com o passo) ───────────────────────────
    const legSwing = Math.sin(walk * Math.PI * 2) * 3;
    const legColor = shade(outfit, -0.45);
    ctx.fillStyle = legColor;
    roundRect(ctx, -6 + legSwing * 0.3, 5, 5, 9, 2);
    ctx.fill();
    roundRect(ctx, 1 - legSwing * 0.3, 5, 5, 9, 2);
    ctx.fill();
    // sapatos
    ctx.fillStyle = '#26211c';
    roundRect(ctx, -6.5 + legSwing * 0.3, 12, 6, 3.4, 1.6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    roundRect(ctx, 0.5 - legSwing * 0.3, 12, 6, 3.4, 1.6);
    ctx.fill();
    ctx.stroke();

    // ── cauda (furry) — desenhada atrás do corpo ────────────────
    if (isFurry) {
      ctx.save();
      ctx.translate(-2, 3);
      ctx.rotate(0.5 + Math.sin(walk * Math.PI * 2) * 0.15);
      ctx.fillStyle = fur.earColor || furColor;
      if (fur.tail === 'bushy') {
        ctx.beginPath();
        ctx.ellipse(0, 0, 4.2, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (fur.tail === 'puff') {
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        roundRect(ctx, -1.6, -1, 3.2, 9, 1.6);
        ctx.fill();
      }
      ctx.restore();
    }

    // ── corpo / torso ────────────────────────────────────────────
    ctx.fillStyle = outfit;
    roundRect(ctx, -7.5, -6, 15, 12, 5);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15,23,42,0.55)';
    ctx.stroke();
    // colarinho/detalhe
    ctx.fillStyle = shade(outfit, 0.25);
    roundRect(ctx, -7.5, -6, 15, 3.5, 3);
    ctx.fill();

    // ── braços ───────────────────────────────────────────────────
    const armSwing = Math.sin(walk * Math.PI * 2 + Math.PI) * 2.5;
    ctx.fillStyle = shade(outfit, -0.15);
    roundRect(ctx, -10.5, -4 + armSwing * 0.4, 3.6, 8, 1.8);
    ctx.fill();
    roundRect(ctx, 7, -4 - armSwing * 0.4, 3.6, 8, 1.8);
    ctx.fill();
    // mãos
    ctx.fillStyle = bodyBase;
    ctx.beginPath();
    ctx.arc(-8.7, 4 + armSwing * 0.4, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(8.8, 4 - armSwing * 0.4, 2, 0, Math.PI * 2);
    ctx.fill();

    // ── cabeça (grande, proporção chibi) ────────────────────────
    ctx.save();
    ctx.translate(0, -13);

    // orelhas furry (atrás da cabeça)
    if (isFurry) {
      ctx.fillStyle = fur.earColor || furColor;
      if (fur.ear === 'long') {
        roundRect(ctx, -7.5, -13, 3.4, 11, 2);
        ctx.fill();
        roundRect(ctx, 4.1, -13, 3.4, 11, 2);
        ctx.fill();
      } else if (fur.ear === 'floppy') {
        ctx.beginPath(); ctx.ellipse(-8, -3, 3, 6, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(8, -3, 3, 6, 0.3, 0, Math.PI * 2); ctx.fill();
      } else {
        // pointed / round-tip / round / horned — triângulo/losango genérico
        ctx.beginPath();
        ctx.moveTo(-8.5, -3); ctx.lineTo(-6, -13); ctx.lineTo(-2.5, -4);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(8.5, -3); ctx.lineTo(6, -13); ctx.lineTo(2.5, -4);
        ctx.closePath(); ctx.fill();
      }
      // interior da orelha
      ctx.fillStyle = shade(fur.earColor || furColor, 0.35);
      if (fur.ear === 'pointed' || fur.ear === 'horned' || fur.ear === 'round-tip' || fur.ear === 'round') {
        ctx.beginPath();
        ctx.moveTo(-7.3, -5); ctx.lineTo(-6, -10); ctx.lineTo(-4, -5.5);
        ctx.closePath(); ctx.fill();
      }
    }

    // cabeça
    ctx.fillStyle = bodyBase;
    ctx.beginPath();
    ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15,23,42,0.5)';
    ctx.stroke();

    // focinho leve (furry) / nariz humano
    if (isFurry) {
      ctx.fillStyle = shade(bodyBase, 0.3);
      ctx.beginPath();
      ctx.ellipse(2.5, 2.5, 4.2, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.arc(5.6, 2, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // olhos (não desenha se estiver de costas / 'up')
    if (!facingUp) {
      ctx.fillStyle = '#1f2937';
      const eyeY = isFurry ? 0.5 : 1;
      ctx.beginPath();
      ctx.arc(3.4, eyeY, 1.35, 0, Math.PI * 2);
      ctx.fill();
      if (!facingSide) {
        ctx.beginPath();
        ctx.arc(-3.4, eyeY, 1.35, 0, Math.PI * 2);
        ctx.fill();
      }
      // brilho
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(3.9, eyeY - 0.4, 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    // cabelo (só faz sentido se não for furry, mas alguns furries também têm topete)
    ctx.fillStyle = hair;
    switch (av.hairStyle) {
      case 'bald':
        break;
      case 'long':
        roundRect(ctx, -9.5, -9, 19, 7, 6);
        ctx.fill();
        roundRect(ctx, -9.5, -4, 4, 14, 2);
        ctx.fill();
        roundRect(ctx, 5.5, -4, 4, 14, 2);
        ctx.fill();
        break;
      case 'mohawk':
        roundRect(ctx, -1.8, -15, 3.6, 8, 1.8);
        ctx.fill();
        break;
      case 'bun':
        ctx.beginPath();
        ctx.arc(0, -8.5, 5.5, Math.PI, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -12.5, 2.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'short':
      default:
        ctx.beginPath();
        ctx.arc(0, -8.5, 6.2, Math.PI * 0.95, Math.PI * 2.05);
        ctx.fill();
        break;
    }

    ctx.restore(); // cabeça

    // ── braço de trabalho / animação "working" ──────────────────
    if (pose.working) {
      ctx.save();
      ctx.globalAlpha = 0.85 + Math.sin(pose.workPhase || 0) * 0.1;
      ctx.fillStyle = shade(outfit, -0.15);
      roundRect(ctx, 5, -3, 4, 6, 1.6);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // scale/translate
  }

  NS.ChibiRenderer = { drawChibi, shade, roundRect };
})(typeof window !== 'undefined' ? window : globalThis);