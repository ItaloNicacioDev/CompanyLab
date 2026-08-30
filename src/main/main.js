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
const { createMainWindow } = require("./windows/mainWindow");

// Handlers IPC
const registerAgentHandlers      = require("./ipc/agentHandlers");
const registerChatHandlers       = require("./ipc/chatHandlers");
const registerDashboardHandlers  = require("./ipc/dashboardHandlers");
const registerDepartmentHandlers = require("./ipc/departmentHandlers");
const registerProjectHandlers    = require("./ipc/projectHandlers");
const registerRuntimeHandlers    = require("./ipc/runtimeHandlers");
const registerTaskHandlers       = require("./ipc/taskHandlers");

// Garante uma unica instancia do app rodando por vez.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

async function bootstrap() {
  // 1. Banco de dados
  await initDatabase();

  // 2. Handlers IPC
  registerAgentHandlers(ipcMain);
  registerChatHandlers(ipcMain);
  registerDashboardHandlers(ipcMain);
  registerDepartmentHandlers(ipcMain);
  registerProjectHandlers(ipcMain);
  registerRuntimeHandlers(ipcMain);
  registerTaskHandlers(ipcMain);

  // 3. Janela principal
  createMainWindow();
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error("[main.js] Falha ao inicializar o app:", err);
  app.quit();
});

// macOS: recria a janela se o app for reativado sem janelas abertas.
app.on("activate", () => {
  const { BrowserWindow } = require("electron");
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Windows / Linux: encerra o processo quando todas as janelas fecham.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 4. Shutdown limpo - fecha a conexao SQLite antes do processo morrer.
app.on("before-quit", async () => {
  await closeDatabase().catch((err) => {
    console.error("[main.js] Erro ao fechar o banco:", err);
  });
});
