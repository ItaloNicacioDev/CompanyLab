# Assets do mundo (tiles, móveis, decorações)

Assim como os sprites de agentes, tudo aqui é opcional. O
`RoomRenderer.js` hoje desenha piso, paredes, portas e móveis
proceduralmente em Canvas 2D. A estrutura de pastas já está preparada
para receber assets reais no futuro:

```
assets/world/tiles/         # texturas de piso (tileable)
assets/world/furniture/     # mesas, cadeiras, racks, plantas, etc.
assets/world/decorations/   # quadros, pôsters, gráficos, itens de apoio
assets/world/rooms/         # backgrounds de sala prontos, se preferir
                             # substituir o desenho procedural inteiro
```

Ao adicionar um PNG/WebP aqui, atualize a função de desenho
correspondente em `RoomRenderer.js` (ex: `drawDesk`, `drawPlant`,
`drawServerRack`) para usar `assetManager.get(key)` e cair no desenho
vetorial atual como fallback caso o arquivo não exista — mesmo padrão
já usado em `AgentSprite._resolveSpriteImage`.