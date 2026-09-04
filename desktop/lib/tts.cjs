const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

/** English fallbacks only if the Spoken Content voice can't be used. */
const FALLBACK_SAY_VOICES = [
  "Samantha (Enhanced)",
  "Samantha (Premium)",
  "Zoe (Premium)",
  "Ava (Premium)",
  "Allison (Enhanced)",
  "Susan (Enhanced)",
  "Tom (Enhanced)",
  "Nicky (Premium)",
  "Samantha",
  "Alex",
];

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

function chunkText(text, maxChars = 1400) {
  const clean = reflowForSpeech(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let rest = clean;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(". ", maxChars);
    if (cut < maxChars * 0.45) cut = rest.lastIndexOf("? ", maxChars);
    if (cut < maxChars * 0.45) cut = rest.lastIndexOf("! ", maxChars);
    if (cut < maxChars * 0.45) cut = rest.lastIndexOf("; ", maxChars);
    if (cut < maxChars * 0.45) cut = rest.lastIndexOf(", ", maxChars);
    if (cut < maxChars * 0.45) cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.45) cut = maxChars;
    const end = cut + (".?!;".includes(rest[cut]) ? 2 : 0);
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * @returns {Promise<{name: string, locale: string}[]>}
 */
async function listSayVoices() {
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await execFileAsync("say", ["-v", "?"], {
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((line) => {
        const match = line.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\b/);
        if (!match) return null;
        return { name: match[1].trim(), locale: match[2] };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Read the Spoken Content voice from System Settings.
 */
async function readSystemVoiceName() {
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
      const raw = stdout.trim();
      if (!raw) continue;

      const fromId = raw.match(
        /(?:voice(?:\.[a-z-]+)?|synthesis\.voice)\.([A-Za-z]+)(?:\.|$)/i,
      );
      if (fromId) return fromId[1];
      if (raw.includes(".")) {
        const compact = raw.match(/\.([A-Za-z]+)$/);
        if (compact) return compact[1];
      }
      return raw.replace(/^"|"$/g, "").trim();
    } catch {
      // try next
    }
  }

  try {
    const { stdout } = await execFileAsync("defaults", [
      "read",
      "com.apple.speech.voice.prefs",
    ]);
    const nameMatch = stdout.match(/SelectedVoiceName\s*=\s*"?([^";\n]+)"?/);
    if (nameMatch) return nameMatch[1].trim();
    const idMatch = stdout.match(
      /SelectedVoiceIdentifier\s*=\s*"?([^";\n]+)"?/,
    );
    if (idMatch) {
      const stem = idMatch[1].match(/\.([A-Za-z]+)(?:\.premium|\.enhanced)?$/i);
      if (stem) return stem[1];
    }
  } catch {
    // domain missing
  }

  return null;
}

function normalizeVoiceToken(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/\b(enhanced|premium|compact|neural)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prefer System Settings → Accessibility → Spoken Content (English).
 * @returns {Promise<{voice: string, useSystemDefault: boolean}>}
 */
async function pickSayVoice() {
  const available = await listSayVoices();
  const english = available.filter((v) =>
    v.locale.toLowerCase().startsWith("en_"),
  );
  const pool = english.length ? english : available;

  const systemName = await readSystemVoiceName();
  if (systemName) {
    const systemNorm = normalizeVoiceToken(systemName);
    const systemEntry = available.find(
      (v) =>
        v.name.toLowerCase() === systemName.toLowerCase() ||
        normalizeVoiceToken(v.name) === systemNorm ||
        normalizeVoiceToken(v.name).startsWith(`${systemNorm} `),
    );

    if (systemEntry && !systemEntry.locale.toLowerCase().startsWith("en_")) {
      // Non-English system voice — fall through to English fallbacks.
    } else if (systemEntry) {
      const enriched = pool
        .filter((v) => normalizeVoiceToken(v.name) === systemNorm)
        .sort((a, b) => {
          const score = (name) =>
            /premium|enhanced/i.test(name) ? 2 : /compact/i.test(name) ? -2 : 0;
          return score(b.name) - score(a.name);
        });
      return {
        voice: enriched[0]?.name || systemEntry.name,
        useSystemDefault: false,
      };
    } else {
      // Name unknown to us — let `say` use the Spoken Content default.
      return { voice: systemName, useSystemDefault: true };
    }
  }

  for (const preferred of FALLBACK_SAY_VOICES) {
    const hit = pool.find(
      (v) => v.name.toLowerCase() === preferred.toLowerCase(),
    );
    if (hit) return { voice: hit.name, useSystemDefault: false };
  }

  const enhanced = pool.find((v) => /premium|enhanced/i.test(v.name));
  if (enhanced) return { voice: enhanced.name, useSystemDefault: false };

  if (process.platform === "darwin") {
    return { voice: "System voice", useSystemDefault: true };
  }

  return { voice: pool[0]?.name || "Samantha", useSystemDefault: false };
}

async function synthesizeWithSay(text, voiceChoice) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "read-to-me-"));
  const chunks = chunkText(text);
  const wavParts = [];
  const chosen = voiceChoice?.voice || "Samantha";
  const useSystemDefault = Boolean(voiceChoice?.useSystemDefault);

  for (let i = 0; i < chunks.length; i += 1) {
    const aiffPath = path.join(dir, `part-${i}.aiff`);
    const wavPath = path.join(dir, `part-${i}.wav`);
    const args = ["-r", "170", "-o", aiffPath];
    // No -v → macOS Spoken Content / system voice.
    if (!useSystemDefault) {
      args.unshift("-v", chosen);
    }
    args.push(chunks[i]);
    await execFileAsync("say", args);
    await execFileAsync("afconvert", [
      "-f",
      "WAVE",
      "-d",
      "LEI16@22050",
      aiffPath,
      wavPath,
    ]);
    wavParts.push(await fs.promises.readFile(wavPath));
  }

  return {
    engine: "macos-say",
    voice: chosen,
    parts: wavParts.map((buf) => buf.toString("base64")),
    mime: "audio/wav",
    wordCount: reflowForSpeech(text).split(/\s+/).filter(Boolean).length,
    text: reflowForSpeech(text),
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

  return {
    engine: "neural",
    voice: "nova",
    parts,
    mime: "audio/mpeg",
    wordCount: reflowForSpeech(text).split(/\s+/).filter(Boolean).length,
    text: reflowForSpeech(text),
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

  if (process.platform === "darwin") {
    const voiceChoice = await pickSayVoice();
    return synthesizeWithSay(clean, voiceChoice);
  }

  return {
    engine: "browser",
    voice: "en-US",
    parts: [],
    mime: null,
    wordCount: clean.split(/\s+/).filter(Boolean).length,
    text: clean,
  };
}

module.exports = {
  synthesizeSpeech,
  listSayVoices,
  pickSayVoice,
  readSystemVoiceName,
  reflowForSpeech,
};
