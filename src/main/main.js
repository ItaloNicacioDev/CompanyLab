/**
 * main.js
 *
 * Ponto de entrada do processo principal do Electron.
 *
 * Ordem de inicializacao:
 *  1. Banco de dados (SQLite) - precisa estar pronto antes de qualquer
 *     handler IPC, pois os handlers fazem queries na hora que o renderer
 *     chama invoke().
 *  2. Registro dos handlers IPC - todos os modulos de ipc/ sao
 *     registrados antes de criar a janela para nao haver corrida.
 *  3. Criacao da janela principal.
 *  4. Shutdown limpo: fecha o banco ao sair.
 */

const { app, ipcMain } = require("electron");

const { initDatabase, closeDatabase } = require("../../backend/database/db");
const AgentManager = require("../../agents/AgentManager");
const Orchestrator = require("../../core/orchestrator/Orchestrator");
const runtimeSessionManager = require("../../backend/runtimes/runtimeSessionManager");
const { createMainWindow } = require("./windows/mainWindow");
const EventBus = require("../../core/events/EventBus");

// Referência da janela principal — precisa existir fora de bootstrap()
// pra dois lugares poderem usá-la: o listener do EventBus (repassar
// eventos reais pro renderer) e o handler de 'activate' do macOS.
let mainWindow = null;

// Handlers IPC
const registerAgentHandlers      = require("./ipc/agentHandlers");
const registerChatHandlers       = require("./ipc/chatHandlers");
const registerCompanyHandlers    = require("./ipc/companyHandlers");
const registerDashboardHandlers  = require("./ipc/dashboardHandlers");
const registerDepartmentHandlers = require("./ipc/departmentHandlers");
const registerProjectHandlers    = require("./ipc/projectHandlers");
const registerRuntimeHandlers    = require("./ipc/runtimeHandlers");
const registerSkillHandlers      = require("./ipc/skillHandlers");
const registerTaskHandlers       = require("./ipc/taskHandlers");
const SkillManager               = require("../../backend/skills/SkillManager");

// Garante uma unica instancia do app rodando por vez.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

async function bootstrap() {
  // 1. Banco de dados
  await initDatabase();

  // 1.5. Inicia o Manager de Agentes na Memória RAM
  await AgentManager.init();
  
  // 1.6. Inicia o Cérebro Orquestrador que liga UI -> Agentes
  Orchestrator.init();

  // 1.7. Garante que a biblioteca pronta de skills existe em skill_packages
  // (idempotente — só insere o que ainda não existe pelo slug).
  await SkillManager.seedLibrary();

  // 2. Handlers IPC
  registerAgentHandlers(ipcMain);
  registerChatHandlers(ipcMain);
  registerCompanyHandlers(ipcMain);
  registerDashboardHandlers(ipcMain);
  registerDepartmentHandlers(ipcMain);
  registerProjectHandlers(ipcMain);
  registerRuntimeHandlers(ipcMain);
  registerSkillHandlers(ipcMain);
  registerTaskHandlers(ipcMain);

  // 3. Janela principal
  mainWindow = createMainWindow();

  // Repassa TODO evento real da empresa pro renderer (seção 34 do spec)
  // — é isso que faz o SceneManager (3D) e o dashboard reagirem sem o
  // main process precisar saber nada sobre Three.js ou DOM.
  EventBus.onAnyEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("event", event);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error("[main.js] Falha ao inicializar o app:", err);
  app.quit();
});

// macOS: recria a janela se o app for reativado sem janelas abertas.
app.on("activate", () => {
  const { BrowserWindow } = require("electron");
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }
});

// Windows / Linux: encerra o processo quando todas as janelas fecham.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 4. Shutdown limpo - fecha a conexao SQLite antes do processo morrer,
//    e derruba qualquer processo de runtime (ex: 'opencode serve') que
//    tenha sido subido escondido, pra nao deixar orfao no Windows/Linux.
app.on("before-quit", async () => {
  await runtimeSessionManager.disposeAll().catch((err) => {
    console.error("[main.js] Erro ao encerrar sessões de runtime:", err);
  });
  await closeDatabase().catch((err) => {
    console.error("[main.js] Erro ao fechar o banco:", err);
  });
});