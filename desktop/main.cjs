const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  nativeImage,
} = require("electron");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { createWorker } = require("tesseract.js");
const { textFromOcrPage } = require("./lib/ocr-layout.cjs");
const {
  synthesizeSpeech,
  synthesizeSpeechChunk,
  planSpeech,
  speakLive,
  stopLiveSay,
  pauseLiveSay,
  resumeLiveSay,
} = require("./lib/tts.cjs");
const crypto = require("crypto");

const execFileAsync = promisify(execFile);

/** Capture size for OCR — large enough to read, small enough to stay fast. */
const OCR_THUMB = { width: 1400, height: 1800 };
/** Tiny thumbnails for scroll/change detection. */
const PEEK_THUMB = { width: 160, height: 200 };
/** Max width fed into Tesseract after capture. */
const OCR_MAX_WIDTH = 1100;

/** @type {BrowserWindow | null} */
let pillWindow = null;
/** @type {import('tesseract.js').Worker | null} */
let ocrWorker = null;
/** @type {string | null} */
let selectedSourceId = null;
/** @type {{ app: string, title: string } | null} */
let lastExternalFocus = null;
/** @type {ReturnType<typeof setInterval> | null} */
let focusPollTimer = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker("eng");
    await ocrWorker.setParameters({
      // Single block of text is faster and good enough for PDF pages.
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

function isOurProcessName(name) {
  return /^(electron|read to me)/i.test((name || "").trim());
}

/**
 * Remember the frontmost non-pill app/window so Read can target
 * "whatever you were just looking at" after clicking the pill.
 */
async function pollExternalFocus() {
  if (process.platform !== "darwin") return;
  if (pillWindow && !pillWindow.isDestroyed() && pillWindow.isFocused()) {
    return;
  }

  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to tell (first application process whose frontmost is true) to get name & "|||" & (name of front window)',
    ]);
    const raw = stdout.trim();
    const [appName, title = ""] = raw.split("|||");
    if (!appName || isOurProcessName(appName)) return;
    lastExternalFocus = {
      app: appName.trim(),
      title: (title || "").trim(),
    };
  } catch {
    // No front window / accessibility permission — ignore.
  }
}

function startFocusPolling() {
  if (focusPollTimer || process.platform !== "darwin") return;
  void pollExternalFocus();
  focusPollTimer = setInterval(() => {
    void pollExternalFocus();
  }, 900);
}

function stopFocusPolling() {
  if (!focusPollTimer) return;
  clearInterval(focusPollTimer);
  focusPollTimer = null;
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

function scoreWindowCandidate(win, focus) {
  const name = (win.name || "").toLowerCase();
  let score = 0;

  if (/\.pdf\b/.test(name)) score += 50;
  if (/preview/.test(name)) score += 30;
  if (/acrobat|adobe|edge|chrome|safari|firefox|brave/.test(name)) score += 12;

  if (focus?.title) {
    const title = focus.title.toLowerCase();
    if (title && name.includes(title)) score += 80;
    if (title && title.includes(name)) score += 40;
  }
  if (focus?.app) {
    const app = focus.app.toLowerCase();
    if (name.includes(app)) score += 25;
    if (app === "preview" && /\.pdf\b/.test(name)) score += 35;
  }

  return score;
}

/**
 * Pick the window the user meant: last focused external app/window,
 * else a PDF/Preview-looking window, else the first available window.
 */
async function resolveTargetWindow(preferredId, thumbnailSize = OCR_THUMB) {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize,
  });
  const usable = sources.filter(
    (source) => source.name && !/^Read to Me/i.test(source.name),
  );
  if (!usable.length) {
    throw new Error("No windows found. Open your PDF in Preview, then try Read again.");
  }

  if (preferredId) {
    const preferred = usable.find((source) => source.id === preferredId);
    if (preferred) return preferred;
  }

  await pollExternalFocus();

  const ranked = [...usable].sort(
    (a, b) =>
      scoreWindowCandidate(b, lastExternalFocus) -
      scoreWindowCandidate(a, lastExternalFocus),
  );
  return ranked[0];
}

async function captureWindowSource(source) {
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("Could not capture that window. Bring it to the front and try again.");
  }
  return { png: source.thumbnail.toPNG(), name: source.name, id: source.id };
}

async function ocrPng(pngBuffer) {
  let image = nativeImage.createFromBuffer(pngBuffer);
  const size = image.getSize();
  if (size.width > OCR_MAX_WIDTH) {
    image = image.resize({ width: OCR_MAX_WIDTH, quality: "better" });
    pngBuffer = image.toPNG();
  }

  const worker = await getOcrWorker();
  const result = await worker.recognize(pngBuffer);
  return textFromOcrPage(result.data);
}

async function readWindowSource(source) {
  const { png, name, id } = await captureWindowSource(source);
  selectedSourceId = id;
  const { text, columns } = await ocrPng(png);
  if (!text) {
    throw new Error(
      "No readable text found. Zoom the PDF a bit, then try Read again.",
    );
  }
  return { text, title: name, columns: columns || 1, id };
}

app.whenReady().then(() => {
  createPillWindow();
  startFocusPolling();
  // Warm OCR in the background so the first Read isn't paying worker startup.
  void getOcrWorker().catch((error) => {
    console.warn("OCR warm-up failed:", error?.message || error);
  });
  app.on("activate", () => {
    if (!pillWindow) createPillWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  stopFocusPolling();
  stopLiveSay();
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

ipcMain.handle("get-focus-hint", async () => lastExternalFocus);

ipcMain.handle("read-selected-window", async () => {
  const source = await resolveTargetWindow(selectedSourceId, OCR_THUMB);
  return readWindowSource(source);
});

ipcMain.handle("read-active-window", async () => {
  const source = await resolveTargetWindow(null, OCR_THUMB);
  return readWindowSource(source);
});

ipcMain.handle("synthesize-speech", async (_event, text) => {
  return synthesizeSpeech(text);
});

ipcMain.handle("plan-speech", async (_event, text) => {
  return planSpeech(text);
});

ipcMain.handle("synthesize-speech-chunk", async (_event, chunk, voice) => {
  return synthesizeSpeechChunk(chunk, voice);
});

ipcMain.handle("speak-live", async (_event, text) => {
  return speakLive(text);
});

ipcMain.handle("stop-live-say", async () => {
  stopLiveSay();
  return { ok: true };
});

ipcMain.handle("pause-live-say", async () => {
  return { ok: pauseLiveSay() };
});

ipcMain.handle("resume-live-say", async () => {
  return { ok: resumeLiveSay() };
});

ipcMain.handle("peek-window", async (_event, sourceId) => {
  const id = sourceId || selectedSourceId;
  if (!id) return null;

  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: PEEK_THUMB,
  });
  const match = sources.find((source) => source.id === id);
  if (!match || match.thumbnail.isEmpty()) return null;

  const png = match.thumbnail.toPNG();
  const hash = crypto.createHash("sha1").update(png).digest("hex");
  return { id, hash, name: match.name };
});

ipcMain.handle("read-window-by-id", async (_event, sourceId) => {
  const source = await resolveTargetWindow(sourceId || selectedSourceId, OCR_THUMB);
  return readWindowSource(source);
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
