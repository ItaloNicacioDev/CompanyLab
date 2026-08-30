/**
 * mainWindow.js
 *
 * Cria a janela principal do CompanyLab.
 *
 * NOTA DE SEGURANÇA (leia antes de mexer em webPreferences):
 * `nodeIntegration: true` + `contextIsolation: false` está ligado de
 * PROPÓSITO. O CompanyLab só carrega HTML local (nunca `loadURL` com
 * endereço remoto) e o app inteiro já é privilegiado por natureza —
 * os próprios agentes de IA mexem em arquivos/shell do usuário. Nesse
 * cenário, o "renderer isolado" do modelo seguro do Electron não
 * protege contra nada que já não seja verdade sobre o app. Módulos
 * como `room/RoomFactory.js` (usa `fs` direto) e o `renderer.js` atual
 * (usa `require('electron')` direto) dependem desse modo.
 *
 * As duas guardas abaixo (`will-navigate` e `setWindowOpenHandler`)
 * fecham a brecha real que sobra: impedir que qualquer link/conteúdo
 * externo tome conta da janela principal.
 *
 * Se um dia o app passar a exibir conteúdo remoto (embutir um webview
 * de terceiro, por exemplo), aí sim migre pra
 * `contextIsolation: true` + `contextBridge` no preload.js — e nesse
 * caso `RoomFactory.js` precisaria passar a ler/escrever seus
 * descriptors via IPC em vez de `fs` direto.
 */

const { BrowserWindow, shell } = require("electron");
const path = require("path");

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false, // só aparece no 'ready-to-show', evita o flash de tela branca
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));

  win.once("ready-to-show", () => win.show());

  // Bloqueia navegação pra qualquer coisa que não seja o próprio HTML
  // local — abre no navegador do sistema em vez de assumir a janela.
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // Idem pra tentativas de abrir uma nova janela (ex: target="_blank").
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  if (process.env.NODE_ENV === "development") {
    win.webContents.openDevTools();
  }

  return win;
}

module.exports = { createMainWindow };