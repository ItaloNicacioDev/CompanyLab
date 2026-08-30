/**
 * preload.js
 *
 * Executado no contexto isolado do renderer, antes de qualquer script
 * da pagina carregar.
 *
 * NOTA: o CompanyLab roda com contextIsolation: false e
 * nodeIntegration: true (ver mainWindow.js para o racional completo).
 * Isso significa que o renderer.js ja tem acesso direto ao Node.js e
 * ao modulo 'electron' sem precisar de contextBridge. Por isso este
 * preload e intencionalmente minimo: ele so injeta globals de
 * conveniencia que economizam boilerplate no renderer sem duplicar
 * logica.
 *
 * Se no futuro o app migrar para contextIsolation: true, este e o
 * lugar correto para expor APIs seguras via contextBridge.
 */

const { ipcRenderer } = require("electron");

/**
 * window.ipc - atalho tipado para ipcRenderer.invoke().
 *
 * Uso no renderer:
 *   const agents = await window.ipc("agent:getAll");
 *   const result = await window.ipc("agent:create", { name: "Aria" });
 */
window.ipc = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

/**
 * window.onEvent - assina eventos IPC vindos do processo principal.
 *
 * Retorna uma funcao de cleanup para remover o listener:
 *   const off = window.onEvent("agent:statusChanged", handler);
 *   // ... mais tarde:
 *   off();
 */
window.onEvent = (channel, handler) => {
  const wrapped = (_event, ...args) => handler(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};
