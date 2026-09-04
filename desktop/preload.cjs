const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readToMe", {
  listWindows: () => ipcRenderer.invoke("list-windows"),
  selectWindow: (id) => ipcRenderer.invoke("select-window", id),
  getSelectedWindow: () => ipcRenderer.invoke("get-selected-window"),
  readSelectedWindow: () => ipcRenderer.invoke("read-selected-window"),
  openReader: () => ipcRenderer.invoke("open-reader"),
  resizePill: (size) => ipcRenderer.invoke("resize-pill", size),
  sendPlaybackState: (state) => ipcRenderer.send("playback-state", state),
  sendPlaybackCommand: (command) => ipcRenderer.send("playback-command", command),
  onReadingText: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("reading-text", listener);
    return () => ipcRenderer.removeListener("reading-text", listener);
  },
  onPlaybackState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("playback-state", listener);
    return () => ipcRenderer.removeListener("playback-state", listener);
  },
  onPlaybackCommand: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("playback-command", listener);
    return () => ipcRenderer.removeListener("playback-command", listener);
  },
});
