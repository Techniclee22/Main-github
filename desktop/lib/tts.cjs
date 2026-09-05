const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const { normalizeQuotes } = require("./ocr-layout.cjs");
const kokoroLive = require("./kokoro-live.cjs");

const { ENGINE, KOKORO_VOICE_LABEL, selectVoice, forceSayRequested } =
  kokoroLive;

/**
 * Join OCR line wraps into continuous prose.
 * `say` pauses on every newline, so visual line breaks must not reach TTS.
 */
function reflowForSpeech(text) {
  return normalizeQuotes(text)
    .split(/\n\n+/)
    .map((block) => {
      const lines = block
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) return "";

      let prose = lines[0];
      for (let i = 1; i < lines.length; i += 1) {
        if (prose.endsWith("-")) {
          prose = `${prose.slice(0, -1)}${lines[i]}`;
        } else {
          prose = `${prose} ${lines[i]}`;
        }
      }
      return prose.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split prose on sentence-ending punctuation. Keeps the trailing mark.
 * Avoid lookbehind so older Electron/Chromium builds stay compatible.
 */
function splitSentences(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = [];
  let start = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (
      (ch === "." || ch === "?" || ch === "!") &&
      (i + 1 === clean.length || clean[i + 1] === " ")
    ) {
      const piece = clean.slice(start, i + 1).trim();
      if (piece) parts.push(piece);
      start = i + 1;
    }
  }
  const tail = clean.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.length ? parts : [clean];
}

/**
 * One sentence per speak turn (cut at every full stop).
 * Mid-utterance stop/interrupt then resumes on the next sentence instead of
 * skipping unread sentences that had been packed into the same turn.
 * Oversized OCR blobs with no period are still hard-split.
 */
function packSentences(sentences, targetChars = 700, maxChars = 1200) {
  void targetChars; // kept for call-site compatibility
  const list = (sentences || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (!list.length) return [];
  const packs = [];
  for (const sentence of list) {
    if (sentence.length > maxChars) {
      packs.push(...hardSplit(sentence, maxChars, maxChars));
      continue;
    }
    packs.push(sentence);
  }
  return packs;
}

function cutNear(rest, maxChars, { minRatio = 0.35, weakCommaRatio = 0.72 } = {}) {
  let cut = rest.lastIndexOf(". ", maxChars);
  if (cut < maxChars * minRatio) cut = rest.lastIndexOf("? ", maxChars);
  if (cut < maxChars * minRatio) cut = rest.lastIndexOf("! ", maxChars);
  // Prefer holding out for a sentence end; only then allow weaker pauses.
  if (cut < maxChars * minRatio) cut = rest.lastIndexOf("; ", maxChars);
  if (cut < maxChars * weakCommaRatio) cut = rest.lastIndexOf(": ", maxChars);
  if (cut < maxChars * weakCommaRatio) cut = rest.lastIndexOf(", ", maxChars);
  if (cut < maxChars * minRatio) cut = rest.lastIndexOf(" ", maxChars);
  if (cut < maxChars * minRatio) cut = maxChars;
  const end = cut + (".?!;:".includes(rest[cut]) ? 2 : 0);
  return end;
}

function hardSplit(text, maxChars, firstMaxChars) {
  const chunks = [];
  let rest = text;
  let budget = firstMaxChars;
  while (rest.length > budget) {
    const end = cutNear(rest, budget);
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
    budget = maxChars;
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Chunk for TTS. Prefer whole sentences packed up to the budget so playback
 * pauses land on breath boundaries, not mid-clause cuts.
 */
function chunkText(text, maxChars = 380, firstMaxChars = 220) {
  const clean = reflowForSpeech(text);
  if (!clean) return [];
  if (clean.length <= firstMaxChars) return [clean];

  const sentences = splitSentences(clean);
  const chunks = [];
  let budget = firstMaxChars;
  let buf = "";

  const flush = () => {
    if (buf) chunks.push(buf);
    buf = "";
    budget = maxChars;
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      const pieces = hardSplit(
        sentence,
        maxChars,
        chunks.length === 0 ? firstMaxChars : maxChars,
      );
      const last = pieces.pop();
      chunks.push(...pieces);
      buf = last || "";
      budget = maxChars;
      continue;
    }
    const joined = buf ? `${buf} ${sentence}` : sentence;
    if (buf && joined.length > budget) {
      flush();
      buf = sentence;
    } else {
      buf = joined;
    }
  }
  flush();
  return chunks;
}

async function readSystemVoiceLabel() {
  if (process.platform !== "darwin") return null;

  const attempts = [
    ["read", "com.apple.speech.voice.prefs", "SelectedVoiceName"],
    ["read", "com.apple.speech.voice.prefs", "SelectedVoiceIdentifier"],
    [
      "read",
      "com.apple.Accessibility",
      "SpeechVoiceIdentifierForSpeakThisSelection",
    ],
  ];

  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync("defaults", args);
      const raw = stdout.trim().replace(/^"|"$/g, "");
      if (!raw) continue;

      const fromId = raw.match(
        /(?:voice(?:\.[a-z-]+)?|synthesis\.voice)\.([A-Za-z]+)(?:\.|$)/i,
      );
      if (fromId) return fromId[1];
      if (raw.includes(".")) {
        const compact = raw.match(/\.([A-Za-z]+)$/);
        if (compact) return compact[1];
      }
      return raw;
    } catch {}
  }

  return null;
}

/** @type {{ voice: string, useSystemDefault: boolean } | null} */
let cachedVoiceChoice = null;

async function pickSayVoice() {
  if (cachedVoiceChoice) return cachedVoiceChoice;
  if (process.platform !== "darwin") {
    cachedVoiceChoice = { voice: "Samantha", useSystemDefault: false };
    return cachedVoiceChoice;
  }
  const label = (await readSystemVoiceLabel()) || "System voice";
  cachedVoiceChoice = { voice: label, useSystemDefault: true };
  return cachedVoiceChoice;
}

const liveDeps = {
  spawn,
  kill: (pid, signal) => process.kill(pid, signal),
  platform: process.platform,
  kokoro: kokoroLive,
};

// Stay under kokoro-worker MAX_TEXT_CHARS (2000). Prefer long pieces so
// pauses land between sentences instead of mid-clause at ~180 chars.
const KOKORO_PIECE_CHARS = 1200;
const KOKORO_FIRST_PIECE_CHARS = 800;

/** @type {import('child_process').ChildProcess | null} */
let liveSayProc = null;
let liveSayPaused = false;
let liveSayGeneration = 0;
/** @type {string | null} */
let liveSayTempFile = null;
let liveSpeakActive = false;
let liveSayWake = null;
/** Set by pauseLiveSay so a kill's close still replays even if Resume wins the race. */
let liveSayReplayPending = false;
/** @type {{ text: string, pieces: string[], pending: Promise<string>, token: number } | null} */
let livePrefetch = null;
let livePrefetchToken = 0;

function unlinkOwnedSayFile(ownedFile) {
  if (!ownedFile) return;
  if (liveSayTempFile === ownedFile) liveSayTempFile = null;
  void fs.promises.unlink(ownedFile).catch(() => {});
}

function signalLiveProc(signal) {
  if (!liveSayProc?.pid) return;
  // afplay is spawned in its own process group so Stop/Pause reach the player,
  // not only a parent shell wrapper.
  try {
    liveDeps.kill(-liveSayProc.pid, signal);
  } catch {
    try {
      liveDeps.kill(liveSayProc.pid, signal);
    } catch {}
  }
}

function wakeLiveGate() {
  const wake = liveSayWake;
  liveSayWake = null;
  if (wake) wake();
}

function clearLivePrefetch() {
  if (!livePrefetch) return;
  const pending = livePrefetch.pending;
  livePrefetch = null;
  livePrefetchToken += 1;
  discardSynth(pending);
}

function stopLivePlayer() {
  liveSayGeneration += 1;
  liveSayPaused = false;
  liveSayReplayPending = false;
  liveSpeakActive = false;
  const proc = liveSayProc;
  const ownedFile = liveSayTempFile;
  liveSayTempFile = null;
  if (proc && !proc.killed) {
    signalLiveProc("SIGCONT");
    signalLiveProc("SIGKILL");
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
  liveSayProc = null;
  unlinkOwnedSayFile(ownedFile);
  wakeLiveGate();
}

function stopLiveSay(options = {}) {
  stopLivePlayer();
  // Keep a warm prefetch across Read when the page was pre-scanned.
  if (!options || !options.keepPrefetch) clearLivePrefetch();
}

function pauseLiveSay() {
  if (!liveSpeakActive || liveSayPaused) return false;
  liveSayPaused = true;
  // Kill the player instead of SIGSTOP. Frozen afplay still lets CoreAudio
  // drain ~1s of buffered audio; tearing the process down cuts that short.
  // playInSeat replays the same WAV from the start on resume.
  liveSayReplayPending = true;
  const proc = liveSayProc;
  signalLiveProc("SIGKILL");
  if (proc && !proc.killed) {
    try {
      proc.kill("SIGKILL");
    } catch {}
  }
  return true;
}

function resumeLiveSay() {
  if (!liveSpeakActive || !liveSayPaused) return false;
  liveSayPaused = false;
  signalLiveProc("SIGCONT");
  wakeLiveGate();
  return true;
}

async function waitWhilePaused(generation) {
  while (liveSayPaused && generation === liveSayGeneration) {
    await new Promise((resolve) => {
      liveSayWake = resolve;
    });
  }
  return generation === liveSayGeneration;
}

async function playInSeat(command, args, ownedFile, generation) {
  while (generation === liveSayGeneration) {
    if (!(await waitWhilePaused(generation))) {
      unlinkOwnedSayFile(ownedFile);
      return { interrupted: true };
    }

    const outcome = await new Promise((resolve, reject) => {
      if (generation !== liveSayGeneration) {
        resolve({ interrupted: true });
        return;
      }

      const proc = liveDeps.spawn(command, args, {
        stdio: "ignore",
        detached: true,
      });
      liveSayProc = proc;
      liveSayTempFile = ownedFile;
      if (liveSayPaused) {
        // Paused between spawn and play — tear down and wait for resume.
        liveSayReplayPending = true;
        signalLiveProc("SIGKILL");
        try {
          proc.kill("SIGKILL");
        } catch {}
      }

      proc.on("error", (error) => {
        if (liveSayProc === proc) liveSayProc = null;
        unlinkOwnedSayFile(ownedFile);
        reject(error);
      });

      proc.on("close", () => {
        if (liveSayProc === proc) liveSayProc = null;
        if (liveSayReplayPending && generation === liveSayGeneration) {
          // Keep the WAV so resume can replay from the start.
          liveSayReplayPending = false;
          resolve({ replay: true });
          return;
        }
        unlinkOwnedSayFile(ownedFile);
        resolve({ interrupted: generation !== liveSayGeneration });
      });
    });

    if (outcome.replay) continue;
    return outcome;
  }
  unlinkOwnedSayFile(ownedFile);
  return { interrupted: true };
}

function startSynth(text, isCurrent) {
  const pending = liveDeps.kokoro.synthToWav(text, isCurrent);
  pending.catch(() => {});
  return pending;
}

function discardSynth(pending) {
  if (!pending) return;
  pending.then((wav) => unlinkOwnedSayFile(wav), () => {});
}

function takeLivePrefetch(clean) {
  if (!livePrefetch || livePrefetch.text !== clean) return null;
  const slot = livePrefetch;
  livePrefetch = null;
  // Adopted synths must survive the next prefetchLive bumping livePrefetchToken;
  // otherwise speakLive returns interrupted with no afplay (silent package skips).
  slot.adopted = true;
  return slot;
}

/**
 * Start synthesizing the next sentence while the current one plays.
 * speakLive reuses a matching prefetch so the gap between sentences is not
 * a full Kokoro synth wait.
 */
function prefetchLive(text) {
  const clean = reflowForSpeech(text);
  if (!clean) return { ok: false };

  const { kokoro, platform } = liveDeps;
  kokoro.warmLiveVoice();
  if (
    selectVoice(kokoro.kokoroStatus().state, {
      forceSay: forceSayRequested(),
      platform,
    }) !== ENGINE.KOKORO
  ) {
    return { ok: false };
  }
  if (livePrefetch?.text === clean) return { ok: true };

  clearLivePrefetch();
  const token = (livePrefetchToken += 1);
  const pieces = chunkText(clean, KOKORO_PIECE_CHARS, KOKORO_FIRST_PIECE_CHARS);
  const slot = { text: clean, pieces, pending: null, token, adopted: false };
  slot.pending = startSynth(
    pieces[0],
    () => slot.adopted || livePrefetchToken === token,
  );
  livePrefetch = slot;
  return { ok: true };
}

async function speakWithKokoro(clean, generation, reused = null) {
  const isCurrent = () => generation === liveSayGeneration;
  const pieces = reused?.pieces || chunkText(clean, KOKORO_PIECE_CHARS, KOKORO_FIRST_PIECE_CHARS);
  let pending = reused
    ? reused.pending.then((wav) => {
        if (!isCurrent()) {
          unlinkOwnedSayFile(wav);
          const error = new Error("interrupted");
          error.code = "interrupted";
          throw error;
        }
        return wav;
      })
    : startSynth(pieces[0], isCurrent);

  try {
    for (let i = 0; i < pieces.length; i += 1) {
      let wav;
      try {
        wav = await pending;
      } catch (error) {
        pending = null;
        if (!isCurrent() || error.code === "interrupted") {
          return { spoke: true, interrupted: true };
        }
        console.warn(`Kokoro synth failed (${error.code || error.message}); using say.`);
        return { spoke: false, rest: pieces.slice(i).join(" ") };
      }
      pending = null;
      if (!isCurrent()) {
        unlinkOwnedSayFile(wav);
        return { spoke: true, interrupted: true };
      }
      pending = i + 1 < pieces.length ? startSynth(pieces[i + 1], isCurrent) : null;

      let played;
      try {
        played = await playInSeat("afplay", [wav], wav, generation);
      } catch (error) {
        liveDeps.kokoro.demoteKokoro(`afplay failed: ${error.message}`);
        return { spoke: false, rest: pieces.slice(i).join(" ") };
      }
      if (played.interrupted) return { spoke: true, interrupted: true };
    }
    return { spoke: true, interrupted: false };
  } finally {
    discardSynth(pending);
  }
}

async function speakWithSay(clean, generation) {
  const file = path.join(
    os.tmpdir(),
    `read-to-me-live-${process.pid}-${Date.now()}.txt`,
  );
  await fs.promises.writeFile(file, clean, "utf8");
  if (generation !== liveSayGeneration) {
    unlinkOwnedSayFile(file);
    return { interrupted: true };
  }

  const args = ["-r", "185", "-f", file];
  if (liveDeps.platform !== "darwin") {
    const voiceChoice = await pickSayVoice();
    args.unshift("-v", voiceChoice.voice || "Samantha");
  }

  return playInSeat("say", args, file, generation);
}

function warmLiveVoice() {
  liveDeps.kokoro.warmLiveVoice();
}

/**
 * Speak one sentence to the speakers now. Kokoro when its worker is ready,
 * otherwise macOS `say`; a Kokoro failure demotes this same sentence to `say`.
 * Throws only when no engine could speak.
 */
async function speakLive(text) {
  const clean = reflowForSpeech(text);
  if (!clean) throw new Error("Nothing to speak.");

  const reused = takeLivePrefetch(clean);
  stopLivePlayer();
  if (!reused) clearLivePrefetch();
  const generation = liveSayGeneration;
  liveSpeakActive = true;
  const { kokoro, platform } = liveDeps;
  kokoro.warmLiveVoice();

  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  const spoken = (engine, voice, interrupted) => ({
    ok: true,
    ...(interrupted ? { interrupted: true } : {}),
    engine,
    voice,
    text: clean,
    wordCount,
  });

  try {
    let rest = clean;
    const engine = selectVoice(kokoro.kokoroStatus().state, {
      forceSay: forceSayRequested(),
      platform,
    });
    if (engine === ENGINE.KOKORO) {
      const outcome = await speakWithKokoro(clean, generation, reused);
      if (outcome.spoke) {
        return spoken(ENGINE.KOKORO, KOKORO_VOICE_LABEL, outcome.interrupted);
      }
      rest = outcome.rest;
    } else if (reused) {
      discardSynth(reused.pending);
    }

    const voicePromise =
      platform === "darwin"
        ? pickSayVoice().catch(() => ({ voice: "System voice" }))
        : pickSayVoice();
    const outcome = await speakWithSay(rest, generation);
    const voiceChoice = await voicePromise;
    return spoken(ENGINE.SAY, voiceChoice.voice, outcome.interrupted);
  } finally {
    if (generation === liveSayGeneration) {
      liveSpeakActive = false;
      liveSayWake = null;
    }
  }
}

async function planSpeech(text) {
  const clean = reflowForSpeech(text);
  if (!clean) throw new Error("Nothing to speak.");

  const voiceChoice = await pickSayVoice();
  const live = process.platform === "darwin";
  return {
    engine: live ? "macos-say-live" : "browser",
    voice: voiceChoice.voice,
    chunks: live ? [clean] : chunkText(clean),
    text: clean,
    wordCount: clean.split(/\s+/).filter(Boolean).length,
  };
}

async function synthesizeOneSayChunk(chunk, label, dir, index) {
  const wavPath = path.join(dir, `part-${index}.wav`);
  const aiffPath = path.join(dir, `part-${index}.aiff`);

  const baseArgs = ["-r", "185"];
  if (process.platform !== "darwin") {
    baseArgs.unshift("-v", label || "Samantha");
  }

  try {
    await execFileAsync("say", [
      ...baseArgs,
      "-o",
      wavPath,
      "--data-format=LEI16@16000",
      chunk,
    ]);
  } catch {
    await execFileAsync("say", [...baseArgs, "-o", aiffPath, chunk]);
    await execFileAsync("afconvert", [
      "-f",
      "WAVE",
      "-d",
      "LEI16@16000",
      aiffPath,
      wavPath,
    ]);
    void fs.promises.unlink(aiffPath).catch(() => {});
  }

  const buf = await fs.promises.readFile(wavPath);
  void fs.promises.unlink(wavPath).catch(() => {});
  return buf.toString("base64");
}

/**
 * For live engine: return text immediately (no WAV).
 * Otherwise synthesize a WAV chunk / browser fallback.
 */
async function synthesizeSpeechChunk(chunkTextValue, voiceLabel) {
  const chunk = reflowForSpeech(chunkTextValue);
  if (!chunk) throw new Error("Empty speech chunk.");

  if (process.platform === "darwin") {
    const label = voiceLabel || (await pickSayVoice()).voice;
    return {
      engine: "macos-say-live",
      voice: label,
      parts: [],
      mime: null,
      text: chunk,
      wordCount: chunk.split(/\s+/).filter(Boolean).length,
    };
  }

  return {
    engine: "browser",
    voice: "en-US",
    parts: [],
    mime: null,
    text: chunk,
    wordCount: chunk.split(/\s+/).filter(Boolean).length,
  };
}

async function synthesizeWithGateway(text) {
  const key = process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return null;

  const baseUrl = process.env.AI_GATEWAY_API_KEY
    ? "https://ai-gateway.vercel.sh/v1"
    : "https://api.openai.com/v1";

  const chunks = chunkText(text, 3500);
  const parts = [];

  for (const chunk of chunks) {
    const res = await fetch(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        voice: "nova",
        input: chunk,
        format: "mp3",
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Natural voice request failed: ${errText.slice(0, 180)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    parts.push(buf.toString("base64"));
  }

  const clean = reflowForSpeech(text);
  return {
    engine: "neural",
    voice: "nova",
    parts,
    mime: "audio/mpeg",
    wordCount: clean.split(/\s+/).filter(Boolean).length,
    text: clean,
  };
}

async function synthesizeSpeech(text) {
  const clean = reflowForSpeech(text);
  if (!clean) throw new Error("Nothing to speak.");

  try {
    const neural = await synthesizeWithGateway(clean);
    if (neural) return neural;
  } catch (error) {
    console.warn("Neural TTS unavailable, falling back:", error.message);
  }

  const plan = await planSpeech(clean);
  return {
    engine: plan.engine,
    voice: plan.voice,
    parts: [],
    mime: null,
    wordCount: plan.wordCount,
    text: plan.text,
  };
}

module.exports = {
  synthesizeSpeech,
  synthesizeSpeechChunk,
  planSpeech,
  pickSayVoice,
  readSystemVoiceLabel,
  reflowForSpeech,
  splitSentences,
  packSentences,
  chunkText,
  speakLive,
  prefetchLive,
  stopLiveSay,
  pauseLiveSay,
  resumeLiveSay,
  warmLiveVoice,
  liveDeps,
};
