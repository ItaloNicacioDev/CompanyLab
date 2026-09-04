/**
 * AssetManager.js
 *
 * Carrega e cacheia assets 2D (sprite sheets, tiles, ícones) usados pelo
 * World2D. Nada aqui é obrigatório: se um arquivo não existir em disco,
 * o AssetManager simplesmente marca o asset como "indisponível" e quem
 * pediu o asset (AgentSprite, RoomRenderer) cai automaticamente para o
 * desenho procedural (ChibiRenderer / formas vetoriais), sem quebrar o
 * app e sem erro no console do usuário final.
 *
 * Estrutura de pastas esperada (ver seção 9/23 do spec):
 *
 *   assets/agents/sprites/human/{idle,walk_down,walk_up,walk_left,walk_right,work}.png
 *   assets/agents/sprites/furry/{fox,wolf,cat,rabbit}/...
 *   assets/world/tiles/*.png
 *   assets/world/furniture/*.png
 *   assets/world/decorations/*.png
 *   assets/ui/*.png
 *
 * Quando esses arquivos existirem, basta apontar `key -> path` e o
 * restante do motor passa a usá-los automaticamente, sem qualquer
 * mudança de API.
 */

'use strict';

(function (root) {
  const NS = (root.CompanyLabWorld2D = root.CompanyLabWorld2D || {});

  class AssetManager {
    constructor(baseUrl) {
      // baseUrl aponta pra pasta assets/ ao lado de index.html.
      this.baseUrl = baseUrl || 'assets/';
      this._cache = new Map(); // key -> HTMLImageElement
      this._failed = new Set(); // keys que já sabemos não existir (evita re-tentar toda hora)
      this._pending = new Map(); // key -> Promise
    }

    /**
     * Tenta carregar uma imagem. Nunca rejeita: em caso de erro/404
     * resolve com `null`, e quem chamou deve usar o fallback procedural.
     * @param {string} key identificador único (ex: 'agents/human/idle')
     * @param {string} [relPath] caminho relativo dentro de assets/ (default: `${key}.png`)
     * @returns {Promise<HTMLImageElement|null>}
     */
    load(key, relPath) {
      if (this._cache.has(key)) return Promise.resolve(this._cache.get(key));
      if (this._failed.has(key)) return Promise.resolve(null);
      if (this._pending.has(key)) return this._pending.get(key);

      const src = this.baseUrl + (relPath || `${key}.png`);
      const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          this._cache.set(key, img);
          this._pending.delete(key);
          resolve(img);
        };
        img.onerror = () => {
          this._failed.add(key);
          this._pending.delete(key);
          resolve(null);
        };
        img.src = src;
      });

      this._pending.set(key, promise);
      return promise;
    }

    /** Versão síncrona: retorna a imagem se já estiver em cache, senão null (e dispara load em background). */
    get(key, relPath) {
      if (this._cache.has(key)) return this._cache.get(key);
      if (!this._failed.has(key) && !this._pending.has(key)) {
        this.load(key, relPath);
      }
      return null;
    }

    has(key) {
      return this._cache.has(key);
    }

    /** Pré-carrega uma lista de {key, path} em paralelo. Não bloqueia — é best effort. */
    preload(entries = []) {
      return Promise.all(entries.map((e) => this.load(e.key, e.path)));
    }
  }

  NS.AssetManager = AssetManager;
})(typeof window !== 'undefined' ? window : globalThis);