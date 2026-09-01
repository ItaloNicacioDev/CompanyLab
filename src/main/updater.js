/**
 * updater.js
 *
 * Auto-update via electron-updater, usando o GitHub Releases do
 * repositório (ItaloNicacioDev/CompanyLab) como fonte.
 *
 * Comportamento (de propósito, não é 100% silencioso):
 *  1. Verifica atualizações ao abrir o app (com um pequeno atraso,
 *     pra não competir com o boot do banco/janela) e depois a cada
 *     4 horas.
 *  2. Se encontrar uma versão nova, mostra um diálogo nativo
 *     perguntando se o usuário quer baixar agora ou depois —
 *     NUNCA baixa nem instala nada sem confirmação explícita.
 *  3. Depois de baixado, mostra outro diálogo perguntando se quer
 *     reiniciar agora pra aplicar, ou deixar pra próxima abertura do
 *     app (o `autoInstallOnAppQuit` cuida desse segundo caso).
 *
 * Também manda o status pro renderer (canal "update:status") pra
 * quem quiser mostrar algo na UI (ex: o label "Sistema pronto" no
 * rodapé da sidebar) — isso é só cosmético, a lógica real de
 * confirmação vive inteiramente aqui, no processo principal.
 */

const { app, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 horas
const STARTUP_DELAY_MS  = 5000;               // espera a janela assentar

let mainWindowRef   = null;
let checkIntervalId = null;
let downloadStarted = false;

function sendStatus(status, extra = {}) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send("update:status", { status, ...extra });
  }
}

function initAutoUpdater(mainWindow) {
  mainWindowRef = mainWindow;

  // Nunca baixa sozinho — só depois que o usuário confirmar no diálogo.
  autoUpdater.autoDownload         = false;
  // Se o usuário adiar o "reiniciar agora", instala na próxima vez
  // que o app for fechado (sem precisar reabrir o diálogo).
  autoUpdater.autoInstallOnAppQuit = true;

  // Em dev normalmente não há releases publicadas / build assinado —
  // evita barulho de erro toda vez que roda `npm run dev`.
  if (process.env.NODE_ENV === "development" && !process.env.FORCE_UPDATE_CHECK) {
    console.log("[updater] Modo dev — checagem de atualização desativada (defina FORCE_UPDATE_CHECK=1 pra testar).");
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    console.log("[updater] Verificando atualizações...");
    sendStatus("checking");
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] Nenhuma atualização disponível.");
    sendStatus("up-to-date");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] Atualização disponível:", info.version);
    sendStatus("available", { version: info.version });
    promptDownload(info);
  });

  autoUpdater.on("download-progress", (progress) => {
    sendStatus("downloading", { percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] Atualização baixada:", info.version);
    sendStatus("downloaded", { version: info.version });
    promptInstall(info);
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] Erro ao verificar/baixar atualização:", err == null ? "" : (err.stack || err));
    sendStatus("error");
  });

  // Checagem inicial (com atraso) + checagens periódicas.
  setTimeout(() => checkForUpdates(), STARTUP_DELAY_MS);
  checkIntervalId = setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);

  app.on("before-quit", () => {
    if (checkIntervalId) clearInterval(checkIntervalId);
  });
}

async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error("[updater] checkForUpdates falhou:", err);
  }
}

async function promptDownload(info) {
  if (downloadStarted) return; // evita diálogo duplicado se cair aqui de novo
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;

  const { response } = await dialog.showMessageBox(mainWindowRef, {
    type: "info",
    title: "Atualização disponível",
    message: "Uma nova versão do CompanyLab está disponível (v" + info.version + ").",
    detail: "Deseja baixar agora? A instalação só acontece depois que você confirmar novamente.",
    buttons: ["Baixar agora", "Agora não"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    downloadStarted = true;
    sendStatus("downloading", { percent: 0 });
    autoUpdater.downloadUpdate().catch((err) => {
      console.error("[updater] downloadUpdate falhou:", err);
      downloadStarted = false;
      sendStatus("error");
    });
  }
}

async function promptInstall(info) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;

  const { response } = await dialog.showMessageBox(mainWindowRef, {
    type: "info",
    title: "Atualização pronta",
    message: "CompanyLab v" + info.version + " foi baixado.",
    detail: "Reinicie agora para aplicar a atualização, ou deixe para a próxima vez que abrir o app.",
    buttons: ["Reiniciar agora", "Depois"],
    defaultId: 0,
    cancelId: 1,
  });

  if (response === 0) {
    autoUpdater.quitAndInstall();
  }
}

module.exports = { initAutoUpdater, checkForUpdates };
