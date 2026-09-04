# Sprites de agentes

Esta pasta é opcional. Enquanto estiver vazia, o CompanyLab desenha os
personagens proceduralmente (estilo chibi) via `ChibiRenderer.js`,
usando as mesmas cores/estilo configurados no avatar builder do app.

Para usar sprites reais, basta colocar os arquivos nos caminhos abaixo
— o `AssetManager` detecta e passa a usá-los automaticamente, sem
nenhuma mudança de código:

```
assets/agents/sprites/human/
    idle.png
    walk_down.png
    walk_up.png
    walk_left.png
    walk_right.png
    work.png

assets/agents/sprites/furry/
    fox/    (mesmos 6 arquivos acima)
    wolf/
    cat/
    rabbit/
```

Tamanho recomendado: ~28x34px (proporção chibi), fundo transparente.

Para adicionar uma nova espécie furry (`deer`, `bear`, `dog`, `dragon`,
...): crie a pasta `assets/agents/sprites/furry/<especie>/` com os
mesmos 6 arquivos, e defina o preset visual correspondente em
`ChibiRenderer.js` (`FUR_PRESETS`) para o fallback continuar coerente
enquanto os PNGs daquela espécie não existirem.