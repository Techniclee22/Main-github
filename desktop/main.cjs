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
const { textFromOcrPage } = require("./lib/ocr-layout.cjs");
const { synthesizeSpeech } = require("./lib/tts.cjs");

/** @type {BrowserWindow | null} */
let pillWindow = null;
/** @type {import('tesseract.js').Worker | null} */
let ocrWorker = null;
/** @type {string | null} */
let selectedSourceId = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker("eng");
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: "3",
      preserve_interword_spaces: "1",
    });
  }
  return ocrWorker;
}

function createPillWindow() {
  const display = screen.getPrimaryDisplay();
  const width = 440;
  const height = 78;
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

async function listWindows() {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true,
  });

  return sources
    .filter((source) => source.name && !/^Read to Me/i.test(source.name))
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
    thumbnailSize: { width: 2800, height: 3600 },
  });

  const match = sources.find((source) => source.id === selectedSourceId);
  if (!match) {
    throw new Error(
      "That window is gone. Pick it again from the list (re-open the PDF if needed).",
    );
  }

  if (match.thumbnail.isEmpty()) {
    throw new Error("Could not capture that window. Bring it to the front and try again.");
  }

  return { png: match.thumbnail.toPNG(), name: match.name };
}

async function ocrPng(pngBuffer) {
  const worker = await getOcrWorker();
  nativeImage.createFromBuffer(pngBuffer);
  const result = await worker.recognize(pngBuffer);
  return textFromOcrPage(result.data);
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
  const { text, columns } = await ocrPng(png);
  if (!text) {
    throw new Error(
      "No readable text found. Zoom the PDF a bit, then try Read again.",
    );
  }

  return { text, title: name, columns: columns || 1 };
});

ipcMain.handle("synthesize-speech", async (_event, text) => {
  return synthesizeSpeech(text);
});

ipcMain.handle("resize-pill", async (_event, { width, height }) => {
  if (!pillWindow || pillWindow.isDestroyed()) return;
  const bounds = pillWindow.getBounds();
  const bottom = bounds.y + bounds.height;
  pillWindow.setBounds({
    x: bounds.x,
    y: bottom - height,
    width,
    height,
  });
});
