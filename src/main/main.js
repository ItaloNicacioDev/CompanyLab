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
  console.log("[1] bootstrap iniciou");

  console.log("[2] iniciando database...");
  await initDatabase();
  console.log("[3] database OK");

  console.log("[4] iniciando AgentManager...");
  await AgentManager.init();
  console.log("[5] AgentManager OK");

  console.log("[6] iniciando Orchestrator...");
  Orchestrator.init();
  console.log("[7] Orchestrator OK");

  console.log("[8] iniciando SkillManager...");
  await SkillManager.seedLibrary();
  console.log("[9] SkillManager OK");

  console.log("[10] registrando IPC...");

  registerAgentHandlers(ipcMain);
  registerChatHandlers(ipcMain);
  registerCompanyHandlers(ipcMain);
  registerDashboardHandlers(ipcMain);
  registerDepartmentHandlers(ipcMain);
  registerProjectHandlers(ipcMain);
  registerRuntimeHandlers(ipcMain);
  registerSkillHandlers(ipcMain);
  registerTaskHandlers(ipcMain);

  console.log("[11] IPC OK");
  console.log("[12] criando janela...");

  mainWindow = createMainWindow();

  console.log("[13] JANELA CRIADA");

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