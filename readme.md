# CompanyLab

**Um "sistema operacional" de empresa de IA — num escritório 2D que você explora, com agentes de IA reais rodando em qualquer CLI que você já usa (OpenCode, Claude Code, Codex).**

CompanyLab é um app desktop (Electron) que representa sua empresa como um escritório virtual: departamentos são salas, colaboradores de IA são personagens andando por elas, e cada um pode estar rodando de verdade em um runtime de agente à sua escolha.

<p align="center">
  <img src="docs/screenshots/office-overview.png" alt="Visão geral do escritório com departamentos e agentes" width="850">
</p>

## ✨ Funcionalidades

- 🏢 **Escritório 2D interativo** — arraste a câmera, dê zoom, clique num agente pra ver os detalhes dele ou entrar na sala.
- 🧑‍💻 **Agentes de IA** — crie agentes, associe a um departamento, e rode-os de verdade em um runtime CLI (veja abaixo).
- 🏬 **Departamentos** — organize os agentes em salas (Marketing, TI, Administrativo, ou o que fizer sentido pra sua operação).
- ✅ **Tarefas** — acompanhe o que está pendente, em andamento e concluído.
- 💬 **Chat** — converse com a empresa inteira ou @mencione um agente específico.
- 📊 **Dashboard** — visão geral de atividade, status dos agentes e estatísticas.
- ⚙️ **Runtimes** — detecta automaticamente quais CLIs de agente (OpenCode, Codex, Claude Code) estão instalados na sua máquina.
- 🧩 **Skills** — uma biblioteca pronta de skills (`SKILL.md`) + suas próprias, instaláveis globalmente em qualquer CLI suportado.
- 🎨 **Temas** — 9 temas prontos pra interface inteira (veja a lista completa mais abaixo).
- 🛠️ **Configurações** — personalize o nome, emoji/logo e cor de destaque da sua empresa.

<p align="center">
  <img src="docs/screenshots/office-close.png" alt="Escritório com salas de departamento e agente em destaque" width="620">
</p>

## 🖥️ Requisitos

- **Node.js** 18 ou superior
- **npm** (vem junto com o Node)
- Num Linux, pode ser necessário `python3` e as ferramentas de build (`build-essential` ou equivalente) pra compilar o módulo nativo do `sqlite3` durante o `npm install`
- Opcional, mas recomendado: pelo menos um CLI de agente instalado — [OpenCode](https://github.com/opencode-ai/opencode), [Claude Code](https://github.com/anthropics/anthropic-cookbook) ou [Codex](https://github.com/openai/codex) — é o que a aba **Runtimes** detecta e o que a aba **Skills** instala globalmente

## 🚀 Instalação (via npm)

```bash
git clone <url-do-seu-repositório>
cd COMPANYLAB
npm install
npm start
```

Isso abre o app em modo produção. Outros scripts úteis:

```bash
npm run dev          # roda em modo desenvolvimento (NODE_ENV=development)
npm run build:win    # gera o instalador (.exe) pra Windows em dist/
npm run build        # gera o instalador pra a plataforma atual
```

> O `npm install` também roda `electron-builder install-app-deps` automaticamente (via `postinstall`), garantindo que os módulos nativos (como o `sqlite3`) fiquem compatíveis com a versão do Electron usada.

## 🎛️ Sidebar

<p align="left">
  <img src="docs/screenshots/sidebar-nav.png" alt="Menu lateral do CompanyLab" width="230">
</p>

| Aba | O que faz |
|---|---|
| **Office** | O escritório 2D — visão geral de todos os departamentos e agentes |
| **Dashboard** | Estatísticas e atividade recente da empresa |
| **Agentes** | Criar, editar e gerenciar os agentes de IA |
| **Departamentos** | Organizar agentes em salas/times |
| **Tarefas** | Board de tarefas da empresa |
| **Chat** | Conversar com a empresa ou @mencionar um agente |
| **Runtimes** | Ver quais CLIs de agente estão instalados na máquina |
| **Skills** | Biblioteca pronta + skills próprias, instaláveis globalmente em qualquer CLI |
| **Temas** | Trocar a paleta de cores de toda a interface |
| **Configurações** | Nome, emoji e cor de destaque da empresa |

## 🎨 Temas disponíveis

| Tema | Estilo |
|---|---|
| Dark (padrão) | Azul sóbrio sobre navy escuro |
| Claro | Interface clara, tons de branco e azul |
| Dracula | Roxo/rosa sobre cinza-azulado escuro |
| Nord | Paleta ártica, tons de azul-gelo |
| Solarized Dark | Tons quentes de terracota sobre petróleo |
| Ocean | Azul-petróleo com destaque em ciano/teal |
| Cyberpunk | Magenta e ciano neon sobre roxo quase-preto |
| Monokai | Clássico de editores de código, ciano sobre verde-oliva escuro |
| Gruvbox Dark | Tons terrosos e retrô, contraste suave |

Trocar de tema muda a paleta da interface inteira (sidebar, cards, botões, modais, ícones). A cor de destaque em **Configurações**, se personalizada, continua valendo por cima do tema escolhido.

## 🧩 Skills

Uma skill é um arquivo `SKILL.md` (formato compatível com OpenCode, Claude Code e Codex) que ensina um agente a fazer algo bem — revisar código, escrever mensagens de commit, otimizar queries SQL, etc. Na aba Skills você pode:

- Instalar qualquer skill da **biblioteca pronta**
- Criar as **suas próprias** skills
- Instalar em **qualquer CLI** que você escolher, sempre em escopo global — disponível em qualquer projeto/runtime da sua máquina, não só dentro do CompanyLab

## 🏗️ Estrutura do projeto

```
COMPANYLAB/
├── src/
│   ├── main/          # processo principal do Electron (IPC handlers, main.js)
│   └── renderer/       # interface (HTML/CSS/JS do app)
├── backend/
│   ├── database/       # SQLite + migrations
│   ├── repositories/    # acesso a dados (agentes, skills, chat...)
│   └── skills/          # biblioteca de skills + instalador
├── core/
│   ├── events/          # barramento de eventos interno
│   ├── orchestrator/    # liga a UI aos agentes
│   └── permissions/, state/
├── agents/              # fábrica/gerenciador de agentes + sprites
├── room/                # renderização do escritório 2D (salas, câmera, avatares)
├── config/               # config padrão (runtimes, empresa)
├── database/migrations/  # schema do SQLite
└── assets/               # ícones e modelos
```

## 📄 Licença

MIT