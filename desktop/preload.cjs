const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readToMe", {
  listWindows: () => ipcRenderer.invoke("list-windows"),
  selectWindow: (id) => ipcRenderer.invoke("select-window", id),
  getSelectedWindow: () => ipcRenderer.invoke("get-selected-window"),
  readSelectedWindow: () => ipcRenderer.invoke("read-selected-window"),
  synthesizeSpeech: (text) => ipcRenderer.invoke("synthesize-speech", text),
  resizePill: (size) => ipcRenderer.invoke("resize-pill", size),
});
