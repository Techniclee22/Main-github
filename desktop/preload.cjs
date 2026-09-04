const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readToMe", {
  listWindows: () => ipcRenderer.invoke("list-windows"),
  selectWindow: (id) => ipcRenderer.invoke("select-window", id),
  getSelectedWindow: () => ipcRenderer.invoke("get-selected-window"),
  getFocusHint: () => ipcRenderer.invoke("get-focus-hint"),
  readSelectedWindow: () => ipcRenderer.invoke("read-selected-window"),
  readActiveWindow: () => ipcRenderer.invoke("read-active-window"),
  synthesizeSpeech: (text) => ipcRenderer.invoke("synthesize-speech", text),
  resizePill: (size) => ipcRenderer.invoke("resize-pill", size),
});
