const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readToMe", {
  listWindows: () => ipcRenderer.invoke("list-windows"),
  selectWindow: (id) => ipcRenderer.invoke("select-window", id),
  getSelectedWindow: () => ipcRenderer.invoke("get-selected-window"),
  getFocusHint: () => ipcRenderer.invoke("get-focus-hint"),
  readSelectedWindow: () => ipcRenderer.invoke("read-selected-window"),
  readActiveWindow: () => ipcRenderer.invoke("read-active-window"),
  readWindowById: (id) => ipcRenderer.invoke("read-window-by-id", id),
  peekWindow: (id) => ipcRenderer.invoke("peek-window", id),
  synthesizeSpeech: (text) => ipcRenderer.invoke("synthesize-speech", text),
  planSpeech: (text) => ipcRenderer.invoke("plan-speech", text),
  synthesizeSpeechChunk: (chunk, voice) =>
    ipcRenderer.invoke("synthesize-speech-chunk", chunk, voice),
  speakLive: (text) => ipcRenderer.invoke("speak-live", text),
  prefetchLive: (text) => ipcRenderer.invoke("prefetch-live", text),
  stopLiveSay: (options) => ipcRenderer.invoke("stop-live-say", options),
  pauseLiveSay: () => ipcRenderer.invoke("pause-live-say"),
  resumeLiveSay: () => ipcRenderer.invoke("resume-live-say"),
  resizePill: (size) => ipcRenderer.invoke("resize-pill", size),
  highlightReading: (opts) => ipcRenderer.invoke("highlight-reading", opts),
  hideReadingHighlight: () => ipcRenderer.invoke("hide-reading-highlight"),
  scrollTargetWindow: () => ipcRenderer.invoke("scroll-target-window"),
});
