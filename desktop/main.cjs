const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  nativeImage,
} = require("electron");
const path = require("path");
const { createWorker } = require("tesseract.js");

/** @type {BrowserWindow | null} */
let pillWindow = null;
/** @type {BrowserWindow | null} */
let readerWindow = null;
/** @type {import('tesseract.js').Worker | null} */
let ocrWorker = null;
/** @type {string | null} */
let selectedSourceId = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker("eng");
  }
  return ocrWorker;
}

function createPillWindow() {
  const display = screen.getPrimaryDisplay();
  const width = 420;
  const height = 72;
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
  const y = Math.round(display.workArea.y + display.workArea.height - height - 28);

  pillWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pillWindow.setAlwaysOnTop(true, "floating");
  pillWindow.loadFile(path.join(__dirname, "renderer", "pill.html"));
  pillWindow.once("ready-to-show", () => pillWindow?.show());
  pillWindow.on("closed", () => {
    pillWindow = null;
  });
}

function createReaderWindow() {
  if (readerWindow && !readerWindow.isDestroyed()) {
    readerWindow.focus();
    return readerWindow;
  }

  const display = screen.getPrimaryDisplay();
  readerWindow = new BrowserWindow({
    width: 480,
    height: 640,
    x: Math.round(display.workArea.x + display.workArea.width - 520),
    y: Math.round(display.workArea.y + 80),
    title: "Read to Me — follow along",
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  readerWindow.setAlwaysOnTop(true, "floating");
  readerWindow.loadFile(path.join(__dirname, "renderer", "reader.html"));
  readerWindow.once("ready-to-show", () => readerWindow?.show());
  readerWindow.on("closed", () => {
    readerWindow = null;
  });
  return readerWindow;
}

async function listWindows() {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });

  return sources
    .filter((source) => source.name && source.name !== "Read to Me")
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL(),
    }));
}

async function captureSelectedWindow() {
  if (!selectedSourceId) {
    throw new Error("Pick a window first (the PDF in Preview, for example).");
  }

  const sources = await desktopCapturer.getSources({
    types: ["window"],
    // High-res still for OCR of a handbook page
    thumbnailSize: { width: 2200, height: 2800 },
  });

  const match = sources.find((source) => source.id === selectedSourceId);
  if (!match) {
    throw new Error(
      "That window is gone. Pick it again from the list (re-open the PDF if needed).",
    );
  }

  const png = match.thumbnail.toPNG();
  return { png, name: match.name };
}

async function ocrPng(pngBuffer) {
  const worker = await getOcrWorker();
  const image = nativeImage.createFromBuffer(pngBuffer);
  const { width, height } = image.getSize();
  // Prefer PNG file buffer for tesseract
  const result = await worker.recognize(pngBuffer);
  return {
    text: (result.data.text || "").trim(),
    width,
    height,
  };
}

app.whenReady().then(() => {
  createPillWindow();

  app.on("activate", () => {
    if (!pillWindow) createPillWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  if (ocrWorker) {
    await ocrWorker.terminate();
    ocrWorker = null;
  }
});

ipcMain.handle("list-windows", async () => listWindows());

ipcMain.handle("select-window", async (_event, sourceId) => {
  selectedSourceId = sourceId;
  return { ok: true };
});

ipcMain.handle("get-selected-window", async () => selectedSourceId);

ipcMain.handle("read-selected-window", async () => {
  const { png, name } = await captureSelectedWindow();
  const { text } = await ocrPng(png);
  if (!text) {
    throw new Error(
      "No readable text found. Zoom the PDF a bit, then try Read again.",
    );
  }

  createReaderWindow();
  readerWindow?.webContents.send("reading-text", { text, title: name });
  pillWindow?.webContents.send("reading-text", { text, title: name });

  return { text, title: name };
});

ipcMain.handle("open-reader", async () => {
  createReaderWindow();
  return { ok: true };
});

ipcMain.handle("resize-pill", async (_event, { width, height }) => {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  const [x, y] = pillWindow.getPosition();
  const bounds = pillWindow.getBounds();
  const bottom = bounds.y + bounds.height;
  pillWindow.setBounds({
    x,
    y: bottom - height,
    width,
    height,
  });
});

ipcMain.on("playback-state", (_event, state) => {
  // Keep pill + reader in sync when either side changes playback.
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send("playback-state", state);
  }
  if (readerWindow && !readerWindow.isDestroyed()) {
    readerWindow.webContents.send("playback-state", state);
  }
});

ipcMain.on("playback-command", (_event, command) => {
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send("playback-command", command);
  }
  if (readerWindow && !readerWindow.isDestroyed()) {
    readerWindow.webContents.send("playback-command", command);
  }
});
