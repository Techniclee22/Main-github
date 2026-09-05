const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
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

/** Tiny thumbs — only used to identify which window to read. */
const IDENTIFY_THUMB = { width: 180, height: 120 };
/** Fallback getSources size when screencapture is unavailable. */
const OCR_THUMB = { width: 1200, height: 1600 };
/** Tiny thumbs for scroll/change detection. */
const PEEK_THUMB = { width: 120, height: 160 };
/** Max width fed into Tesseract (smaller = much faster). */
const OCR_MAX_WIDTH = 900;

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
      // Auto page segmentation keeps two-column order working.
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
 * Electron source ids look like "window:CGWindowID:0" on macOS.
 */
function nativeWindowId(sourceId) {
  const parts = String(sourceId || "").split(":");
  return parts.length >= 2 && /^\d+$/.test(parts[1]) ? parts[1] : null;
}

/**
 * Pick the window the user meant using tiny thumbnails only.
 * Do NOT capture every window at OCR resolution — that alone costs seconds.
 */
async function resolveTargetWindow(preferredId) {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: IDENTIFY_THUMB,
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

  // Use the cached focus hint from background polling — don't wait on
  // another osascript round-trip at click time.
  const ranked = [...usable].sort(
    (a, b) =>
      scoreWindowCandidate(b, lastExternalFocus) -
      scoreWindowCandidate(a, lastExternalFocus),
  );
  return ranked[0];
}

/**
 * Capture ONE window quickly.
 * On macOS, `screencapture -l` grabs only that window (vs thumbnailizing all).
 */
async function captureWindowPng(sourceId, fallbackSource) {
  if (process.platform === "darwin") {
    const cgId = nativeWindowId(sourceId);
    if (cgId) {
      const outPath = path.join(
        os.tmpdir(),
        `read-to-me-${cgId}-${process.pid}-${Date.now()}.png`,
      );
      try {
        await execFileAsync(
          "screencapture",
          ["-x", "-o", "-t", "png", "-l", String(cgId), outPath],
          { timeout: 8000 },
        );
        const png = await fs.promises.readFile(outPath);
        void fs.promises.unlink(outPath).catch(() => {});
        if (png.length > 200) return png;
      } catch (error) {
        console.warn(
          "screencapture failed, falling back to desktopCapturer:",
          error?.message || error,
        );
        void fs.promises.unlink(outPath).catch(() => {});
      }
    }
  }

  if (fallbackSource?.thumbnail && !fallbackSource.thumbnail.isEmpty()) {
    // Identify thumbs are too small for OCR — fetch a larger one.
    const size = fallbackSource.thumbnail.getSize();
    if (size.width >= 800) return fallbackSource.thumbnail.toPNG();
  }

  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: OCR_THUMB,
  });
  const match = sources.find((source) => source.id === sourceId);
  if (!match || match.thumbnail.isEmpty()) {
    throw new Error(
      "Could not capture that window. Bring it to the front and try again.",
    );
  }
  return match.thumbnail.toPNG();
}

async function ocrPng(pngBuffer) {
  let image = nativeImage.createFromBuffer(pngBuffer);
  const size = image.getSize();
  if (size.width > OCR_MAX_WIDTH) {
    // "good" is faster than "better" and still readable for TTS.
    image = image.resize({ width: OCR_MAX_WIDTH, quality: "good" });
    pngBuffer = image.toPNG();
  }

  const worker = await getOcrWorker();
  const result = await worker.recognize(pngBuffer);
  return textFromOcrPage(result.data);
}

async function readWindowSource(source) {
  selectedSourceId = source.id;
  const png = await captureWindowPng(source.id, source);
  const { text, columns } = await ocrPng(png);
  if (!text) {
    throw new Error(
      "No readable text found. Zoom the PDF a bit, then try Read again.",
    );
  }
  return { text, title: source.name, columns: columns || 1, id: source.id };
}

app.whenReady().then(() => {
  createPillWindow();
  startFocusPolling();
  // Warm OCR (and macOS speech) so the first Read isn't paying cold-start.
  void getOcrWorker().catch((error) => {
    console.warn("OCR warm-up failed:", error?.message || error);
  });
  if (process.platform === "darwin") {
    void execFileAsync("say", ["-r", "200", " "]).catch(() => {});
  }
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
  const source = await resolveTargetWindow(selectedSourceId);
  return readWindowSource(source);
});

ipcMain.handle("read-active-window", async () => {
  const source = await resolveTargetWindow(null);
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
  const source = await resolveTargetWindow(sourceId || selectedSourceId);
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
