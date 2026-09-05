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
const { pickSource } = require("./lib/window-pick.cjs");
const { shouldInvertBgra, invertBgra } = require("./lib/ocr-image.cjs");
const { textFromOcrPage } = require("./lib/ocr-layout.cjs");
const {
  synthesizeSpeech,
  synthesizeSpeechChunk,
  planSpeech,
  speakLive,
  prefetchLive,
  stopLiveSay,
  pauseLiveSay,
  resumeLiveSay,
  warmLiveVoice,
} = require("./lib/tts.cjs");

const execFileAsync = promisify(execFile);

/** Tiny thumbs — only used to identify which window to read. */
const IDENTIFY_THUMB = { width: 160, height: 100 };
/** Fallback getSources size when screencapture is unavailable. */
const OCR_THUMB = { width: 1400, height: 1800 };
/** Tiny thumbs for scroll/change detection. */
const PEEK_THUMB = { width: 64, height: 80 };
/** Max width fed into Tesseract — keep high enough that letters stay sharp. */
const OCR_MAX_WIDTH = 1100;
/** OCR most of the visible page (was too aggressive and produced gibberish). */
const OCR_TOP_FRACTION = 0.88;
/** Max dimension after screencapture (Retina dumps are huge otherwise). */
const CAPTURE_MAX_DIM = 1600;
/** White pad around OCR image — stops leptonica boxClip spam. */
const OCR_BORDER_PX = 16;

/** @type {BrowserWindow | null} */
let pillWindow = null;
/** @type {BrowserWindow | null} */
let highlightWindow = null;
/** @type {import('tesseract.js').Worker | null} */
let ocrWorker = null;
/** @type {Promise<import('tesseract.js').Worker> | null} */
let ocrWorkerPromise = null;
/** @type {string | null} */
let selectedSourceId = null;
/** @type {{ app: string, title: string } | null} */
let lastExternalFocus = null;
/** @type {ReturnType<typeof setInterval> | null} */
let focusPollTimer = null;

const HIGHLIGHT_BAND_PX = 48;

function escapeAppleScriptString(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/** Mute leptonica/tesseract spam that writes straight to stderr. */
function installTessStderrFilter() {
  if (global.__readToMeTessStderrFiltered) return;
  global.__readToMeTessStderrFiltered = true;
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, encoding, cb) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk);
    if (
      /Error in boxClipToRectangle|Error in pixScanForForeground|boxClipToRectangle|pixScanForForeground|Estimating resolution|box outside rectangle|invalid box|Error in box|Error in pix/i.test(
        text,
      )
    ) {
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    }
    return origWrite(chunk, encoding, cb);
  };
}

installTessStderrFilter();

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: () => {},
        errorHandler: () => {},
      });
      await worker.setParameters({
        tessedit_pageseg_mode: "3",
        preserve_interword_spaces: "1",
        tessedit_do_invert: "0",
        textord_heavy_nr: "0",
        classify_enable_learning: "0",
        user_defined_dpi: "220",
      });
      ocrWorker = worker;
      return worker;
    })().catch((error) => {
      ocrWorkerPromise = null;
      ocrWorker = null;
      throw error;
    });
  }
  return ocrWorkerPromise;
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

function ensureHighlightWindow() {
  if (highlightWindow && !highlightWindow.isDestroyed()) return highlightWindow;

  highlightWindow = new BrowserWindow({
    width: 200,
    height: HIGHLIGHT_BAND_PX,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  highlightWindow.setIgnoreMouseEvents(true);
  highlightWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  highlightWindow.setAlwaysOnTop(true, "screen-saver");
  highlightWindow.loadFile(path.join(__dirname, "renderer", "highlight.html"));
  highlightWindow.on("closed", () => {
    highlightWindow = null;
  });
  return highlightWindow;
}

function destroyHighlightWindow() {
  if (!highlightWindow || highlightWindow.isDestroyed()) {
    highlightWindow = null;
    return;
  }
  highlightWindow.destroy();
  highlightWindow = null;
}

/**
 * Screen bounds of the external app's front window (macOS).
 * Falls back to the primary display work area.
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 */
async function getSourceScreenBounds(_sourceId) {
  const fallback = () => {
    const area = screen.getPrimaryDisplay().workArea;
    return {
      x: Math.round(area.x),
      y: Math.round(area.y),
      width: Math.round(area.width),
      height: Math.round(area.height),
    };
  };

  if (process.platform !== "darwin") return fallback();

  const hint = await refreshFrontmost();
  const appName = hint?.app;
  if (!appName || isOurProcessName(appName)) return fallback();

  try {
    const escaped = escapeAppleScriptString(appName);
    const { stdout } = await execFileAsync(
      "osascript",
      [
        "-e",
        `tell application "System Events" to tell application process "${escaped}" to get {position, size} of front window`,
      ],
      { timeout: 2500 },
    );
    const nums = String(stdout)
      .match(/-?\d+/g)
      ?.map((n) => Number(n));
    if (nums && nums.length >= 4 && nums[2] > 0 && nums[3] > 0) {
      return {
        x: nums[0],
        y: nums[1],
        width: nums[2],
        height: nums[3],
      };
    }
  } catch {
    // Accessibility / no front window — fall through.
  }

  return fallback();
}

/**
 * Place the translucent reading band at a vertical fraction of the target window.
 */
async function showReadingHighlight({ sourceId, fraction } = {}) {
  const bounds = await getSourceScreenBounds(sourceId);
  if (!bounds) return { ok: false };

  const win = ensureHighlightWindow();
  const frac = Math.min(1, Math.max(0, Number(fraction) || 0));
  const rawY = Math.round(bounds.y + bounds.height * frac);
  const y = Math.max(
    bounds.y,
    Math.min(rawY, bounds.y + bounds.height - HIGHLIGHT_BAND_PX),
  );

  win.setBounds({
    x: Math.round(bounds.x),
    y,
    width: Math.round(bounds.width),
    height: HIGHLIGHT_BAND_PX,
  });
  win.setIgnoreMouseEvents(true);
  if (!win.isVisible()) win.showInactive();
  return { ok: true };
}

function hideReadingHighlight() {
  if (highlightWindow && !highlightWindow.isDestroyed()) {
    highlightWindow.hide();
  }
  return { ok: true };
}

/**
 * Best-effort scroll of the last external app (~one viewport / ~70% height).
 */
async function scrollTargetWindow() {
  if (process.platform !== "darwin") return { ok: false };

  const hint = await refreshFrontmost();
  const appName = hint?.app;
  if (!appName || isOurProcessName(appName)) {
    return { ok: false, reason: "no-target" };
  }

  const escaped = escapeAppleScriptString(appName);
  try {
    // Page Down only — do not steal focus back to an old app.
    await execFileAsync(
      "osascript",
      [
        "-e",
        `tell application "System Events"
  tell application process "${escaped}"
    if frontmost is false then return
  end tell
  key code 121
end tell`,
      ],
      { timeout: 4000 },
    );
    return { ok: true };
  } catch (error) {
    console.warn("scroll-target-window failed:", error?.message || error);
    return { ok: false };
  }
}

function isOurProcessName(name) {
  return /^(electron|read to me)/i.test((name || "").trim());
}

/**
 * Remember the frontmost non-pill app/window so Read can target
 * "whatever you were just looking at" after clicking the pill.
 */
async function refreshFrontmost() {
  if (process.platform !== "darwin") return lastExternalFocus;
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to tell (first application process whose frontmost is true) to get name & "|||" & (name of front window)',
    ]);
    const raw = stdout.trim();
    const [appName, title = ""] = raw.split("|||");
    if (!appName || isOurProcessName(appName)) return lastExternalFocus;
    lastExternalFocus = {
      app: appName.trim(),
      title: (title || "").trim(),
    };
  } catch {
    // No front window / accessibility permission — keep last hint.
  }
  return lastExternalFocus;
}

async function pollExternalFocus() {
  await refreshFrontmost();
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

function nativeWindowId(sourceId) {
  const parts = String(sourceId || "").split(":");
  return parts.length >= 2 && /^\d+$/.test(parts[1]) ? parts[1] : null;
}

async function listAppWindowTitles(appName) {
  if (process.platform !== "darwin" || !appName) return [];
  try {
    const escaped = escapeAppleScriptString(appName);
    const { stdout } = await execFileAsync(
      "osascript",
      [
        "-e",
        `tell application "System Events"
  set acc to ""
  tell application process "${escaped}"
    repeat with w in windows
      set acc to acc & "|||" & (name of w as text)
    end repeat
  end tell
  return acc
end tell`,
      ],
      { timeout: 2500 },
    );
    return String(stdout)
      .split("|||")
      .map((part) => part.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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

  const appTitles = lastExternalFocus?.app
    ? await listAppWindowTitles(lastExternalFocus.app)
    : [];
  return pickSource(usable, lastExternalFocus, appTitles);
}

/**
 * Capture ONE window quickly.
 * On macOS, `screencapture -l` grabs only that window (vs thumbnailizing all).
 */
async function captureWindowPng(sourceId, fallbackSource) {
  if (process.platform === "darwin") {
    const cgId = nativeWindowId(sourceId);
    if (cgId) {
      // PNG keeps text sharp for OCR (JPEG artifacts caused gibberish speech).
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
        // Retina dumps are huge; shrink on disk before Electron decodes.
        await execFileAsync(
          "sips",
          ["-Z", String(CAPTURE_MAX_DIM), outPath],
          { timeout: 5000 },
        ).catch(() => {});
        const buf = await fs.promises.readFile(outPath);
        void fs.promises.unlink(outPath).catch(() => {});
        if (buf.length > 200) return buf;
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

/**
 * Pad an image with a white border (fixes leptonica boxClipToRectangle spam).
 */
function addWhiteBorder(image, pad) {
  const { width, height } = image.getSize();
  const outW = width + pad * 2;
  const outH = height + pad * 2;
  const src = image.toBitmap(); // BGRA
  const out = Buffer.alloc(outW * outH * 4, 255);
  for (let y = 0; y < height; y += 1) {
    const srcOff = y * width * 4;
    const dstOff = ((y + pad) * outW + pad) * 4;
    src.copy(out, dstOff, srcOff, srcOff + width * 4);
  }
  return nativeImage.createFromBitmap(out, { width: outW, height: outH });
}

/**
 * Prepare a sharp, opaque image for Tesseract.
 * Prior version crushed to ~520px JPEG@72 → gibberish speech.
 */
function prepareImageForOcr(imageBuffer) {
  let image = nativeImage.createFromBuffer(imageBuffer);
  let { width, height } = image.getSize();
  if (width < 16 || height < 16) {
    throw new Error(
      "Captured image was empty. Bring the window to the front and try again.",
    );
  }

  // Mild inset only — keep as many pixels of text as possible.
  const inset = 1;
  if (width > 40 && height > 40) {
    image = image.crop({
      x: inset,
      y: inset,
      width: width - inset * 2,
      height: height - inset * 2,
    });
    ({ width, height } = image.getSize());
  }

  if (width > OCR_MAX_WIDTH) {
    image = image.resize({ width: OCR_MAX_WIDTH, quality: "best" });
    ({ width, height } = image.getSize());
  }

  const cropHeight = Math.max(120, Math.floor(height * OCR_TOP_FRACTION));
  if (cropHeight < height) {
    image = image.crop({ x: 0, y: 0, width, height: cropHeight });
    ({ width, height } = image.getSize());
  }

  const bitmap = image.toBitmap();
  if (shouldInvertBgra(bitmap)) {
    image = nativeImage.createFromBitmap(invertBgra(bitmap), {
      width,
      height,
    });
  }

  image = addWhiteBorder(image, OCR_BORDER_PX);
  ({ width, height } = image.getSize());

  // Opaque PNG (no alpha) — better OCR than lossy JPEG.
  return { png: image.toPNG(), width, height };
}

function isTessNoiseMessage(args) {
  const msg = args.map((a) => String(a ?? "")).join(" ");
  return /box\s*outside\s*rectangle|invalid\s*box|boxcliptorectangle|pixscanforforeground|estimating resolution|error in box/i.test(
    msg,
  );
}

/** Flatten tesseract.js blocks → words when top-level words are missing. */
function pageWithWords(data) {
  if (data?.words?.length) return data;
  const words = [];
  for (const block of data?.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const word of line.words || []) words.push(word);
      }
    }
  }
  return { ...data, words };
}

async function ocrPng(imageBuffer) {
  const prepared = prepareImageForOcr(imageBuffer);
  const worker = await getOcrWorker();
  const prevWarn = console.warn;
  const prevError = console.error;
  const prevLog = console.log;
  console.warn = (...args) => {
    if (isTessNoiseMessage(args)) return;
    prevWarn(...args);
  };
  console.error = (...args) => {
    if (isTessNoiseMessage(args)) return;
    prevError(...args);
  };
  console.log = (...args) => {
    if (isTessNoiseMessage(args)) return;
    prevLog(...args);
  };
  try {
    // debug:true redirects "Estimating resolution" into result.data.debug
    // instead of the terminal. blocks:true supplies word boxes for columns.
    const result = await worker.recognize(
      prepared.png,
      {},
      { text: true, blocks: true, debug: true },
    );
    return textFromOcrPage(pageWithWords(result.data), {
      width: prepared.width,
      height: prepared.height,
    });
  } finally {
    console.warn = prevWarn;
    console.error = prevError;
    console.log = prevLog;
  }
}

function peekVerticalProfile(image) {
  const width = 24;
  const height = 48;
  const tiny = image.resize({ width, height, quality: "good" });
  const bgra = tiny.toBitmap();
  const profile = new Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // BGRA → luminance (nativeImage.toBitmap channel order)
      sum += 0.114 * bgra[i] + 0.587 * bgra[i + 1] + 0.299 * bgra[i + 2];
    }
    profile[y] = Math.round(sum / width);
  }
  return profile;
}


async function readWindowSource(source, { softEmpty = false } = {}) {
  selectedSourceId = source.id;
  const png = await captureWindowPng(source.id, source);
  const layout = await ocrPng(png);
  const text = layout.text;
  const columns = layout.columns || 1;
  const words = layout.words || [];
  if (!text) {
    if (softEmpty) {
      return {
        text: "",
        title: source.name,
        columns: columns,
        id: source.id,
        empty: true,
        words: words,
      };
    }
    throw new Error(
      "No readable text found. Zoom the PDF a bit, then try Read again.",
    );
  }
  return {
    text: text,
    title: source.name,
    columns: columns,
    id: source.id,
    words: words,
  };
}

app.whenReady().then(() => {
  createPillWindow();
  startFocusPolling();
  void getOcrWorker().catch((error) => {
    console.warn("OCR warm-up failed:", error?.message || error);
  });
  warmLiveVoice();
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
  hideReadingHighlight();
  destroyHighlightWindow();
  stopFocusPolling();
  stopLiveSay();
  if (ocrWorkerPromise) {
    try {
      const worker = await ocrWorkerPromise;
      await worker.terminate();
    } catch {
      // ignore
    }
    ocrWorkerPromise = null;
    ocrWorker = null;
  }
});

ipcMain.handle("list-windows", async () => listWindows());

ipcMain.handle("select-window", async (_event, sourceId) => {
  selectedSourceId = sourceId;
  return { ok: true };
});

ipcMain.handle("get-selected-window", async () => selectedSourceId);

ipcMain.handle("get-focus-hint", async () => refreshFrontmost());

ipcMain.handle("read-selected-window", async () => {
  const source = await resolveTargetWindow(selectedSourceId);
  if (!source) {
    throw new Error(
      "No readable window found. Click the window, then try Read again.",
    );
  }
  return readWindowSource(source);
});

ipcMain.handle("read-active-window", async () => {
  await refreshFrontmost();
  const source = await resolveTargetWindow(null);
  if (!source) {
    return {
      text: "",
      title: lastExternalFocus?.app || "",
      columns: 1,
      id: null,
      empty: true,
      words: [],
    };
  }
  return readWindowSource(source, { softEmpty: true });
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

ipcMain.handle("speak-live", async (_event, text, options) => {
  return speakLive(text, options || {});
});

ipcMain.handle("prefetch-live", async (_event, text) => {
  return prefetchLive(text);
});

ipcMain.handle("stop-live-say", async (_event, options) => {
  stopLiveSay(options || {});
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

  const profile = peekVerticalProfile(match.thumbnail);
  return { id, profile, name: match.name };
});

ipcMain.handle("read-window-by-id", async (_event, sourceId) => {
  const source = await resolveTargetWindow(sourceId || selectedSourceId);
  return readWindowSource(source);
});

ipcMain.handle("highlight-reading", async (_event, payload = {}) => {
  return showReadingHighlight(payload);
});

ipcMain.handle("hide-reading-highlight", async () => hideReadingHighlight());

ipcMain.handle("scroll-target-window", async () => scrollTargetWindow());

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
