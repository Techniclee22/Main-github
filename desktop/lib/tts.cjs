const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

/**
 * Join OCR line wraps into continuous prose.
 * `say` pauses on every newline, so visual line breaks must not reach TTS.
 */
function reflowForSpeech(text) {
  return String(text || "")
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
 * Split at a natural boundary near maxChars.
 */
function cutNear(rest, maxChars) {
  let cut = rest.lastIndexOf(". ", maxChars);
  if (cut < maxChars * 0.35) cut = rest.lastIndexOf("? ", maxChars);
  if (cut < maxChars * 0.35) cut = rest.lastIndexOf("! ", maxChars);
  if (cut < maxChars * 0.35) cut = rest.lastIndexOf("; ", maxChars);
  if (cut < maxChars * 0.35) cut = rest.lastIndexOf(", ", maxChars);
  if (cut < maxChars * 0.35) cut = rest.lastIndexOf(" ", maxChars);
  if (cut < maxChars * 0.35) cut = maxChars;
  const end = cut + (".?!;".includes(rest[cut]) ? 2 : 0);
  return end;
}

/**
 * Small chunks → first audio starts fast; later chunks synthesize while playing.
 * First chunk is especially short so `say` returns sooner.
 */
function chunkText(text, maxChars = 380, firstMaxChars = 220) {
  const clean = reflowForSpeech(text);
  if (!clean) return [];
  if (clean.length <= firstMaxChars) return [clean];

  const chunks = [];
  let rest = clean;

  // Prefer a quick first sentence/clause so playback can begin ASAP.
  const firstEnd = cutNear(rest, firstMaxChars);
  chunks.push(rest.slice(0, firstEnd).trim());
  rest = rest.slice(firstEnd).trim();

  while (rest.length > maxChars) {
    const end = cutNear(rest, maxChars);
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
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
    } catch {
      // try next
    }
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

/**
 * Synthesize one short chunk to WAV.
 * Prefer `say` writing WAV directly (skips afconvert) for lower latency.
 */
async function synthesizeOneSayChunk(chunk, label, dir, index) {
  const wavPath = path.join(dir, `part-${index}.wav`);
  const aiffPath = path.join(dir, `part-${index}.aiff`);

  // No -v on macOS → Spoken Content / system voice (matches Terminal `say`).
  const baseArgs = ["-r", "175"];
  if (process.platform !== "darwin") {
    baseArgs.unshift("-v", label || "Samantha");
  }

  try {
    // Direct WAV is much faster than AIFF + afconvert.
    await execFileAsync("say", [
      ...baseArgs,
      "-o",
      wavPath,
      "--data-format=LEI16@16000",
      chunk,
    ]);
  } catch {
    // Older macOS / non-WAV `say`: fall back to AIFF → afconvert.
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
 * Plan speech without synthesizing — returns small text chunks + voice label.
 */
async function planSpeech(text) {
  const clean = reflowForSpeech(text);
  if (!clean) throw new Error("Nothing to speak.");

  const voiceChoice = await pickSayVoice();
  return {
    engine: process.platform === "darwin" ? "macos-say" : "browser",
    voice: voiceChoice.voice,
    chunks: chunkText(clean),
    text: clean,
    wordCount: clean.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Synthesize a single short chunk quickly (for streamed playback).
 */
async function synthesizeSpeechChunk(chunkTextValue, voiceLabel) {
  const chunk = reflowForSpeech(chunkTextValue);
  if (!chunk) throw new Error("Empty speech chunk.");

  if (process.platform === "darwin") {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "read-to-me-"));
    try {
      const label = voiceLabel || (await pickSayVoice()).voice;
      const part = await synthesizeOneSayChunk(chunk, label, dir, 0);
      return {
        engine: "macos-say",
        voice: label,
        parts: [part],
        mime: "audio/wav",
        text: chunk,
        wordCount: chunk.split(/\s+/).filter(Boolean).length,
      };
    } finally {
      void fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Non-Mac / fallback: let the renderer use browser TTS for this chunk.
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

/** Full synthesize (used rarely; streaming path is preferred). */
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
  if (plan.engine === "browser") {
    return {
      engine: "browser",
      voice: "en-US",
      parts: [],
      mime: null,
      wordCount: plan.wordCount,
      text: plan.text,
    };
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "read-to-me-"));
  try {
    const wavParts = [];
    for (let i = 0; i < plan.chunks.length; i += 1) {
      wavParts.push(await synthesizeOneSayChunk(plan.chunks[i], plan.voice, dir, i));
    }
    return {
      engine: "macos-say",
      voice: plan.voice,
      parts: wavParts,
      mime: "audio/wav",
      wordCount: plan.wordCount,
      text: plan.text,
    };
  } finally {
    void fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  synthesizeSpeech,
  synthesizeSpeechChunk,
  planSpeech,
  pickSayVoice,
  readSystemVoiceLabel,
  reflowForSpeech,
  chunkText,
};
