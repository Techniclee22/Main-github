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
 * Best-effort label for status UI only.
 * Prefs keys are often stale across macOS versions — never use this for `say -v`.
 */
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

/**
 * On Mac, always match Terminal `say "..."`: omit `-v`.
 * Passing `-v` from prefs/fallbacks is what kept the app stuck on Samantha.
 */
async function pickSayVoice() {
  if (process.platform !== "darwin") {
    return { voice: "Samantha", useSystemDefault: false };
  }
  const label = (await readSystemVoiceLabel()) || "System voice";
  return { voice: label, useSystemDefault: true };
}

async function synthesizeWithSay(text, voiceChoice) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "read-to-me-"));
  const chunks = chunkText(text);
  const wavParts = [];
  const label = voiceChoice?.voice || "System voice";

  for (let i = 0; i < chunks.length; i += 1) {
    const aiffPath = path.join(dir, `part-${i}.aiff`);
    const wavPath = path.join(dir, `part-${i}.wav`);

    // Critical: do NOT pass -v on macOS.
    // Terminal `say "text"` uses Spoken Content; `-v Name` overrides it.
    const args = ["-r", "170", "-o", aiffPath, chunks[i]];
    if (process.platform !== "darwin") {
      args.unshift("-v", label);
    }

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

  const clean = reflowForSpeech(text);
  return {
    engine: "macos-say",
    voice: label,
    parts: wavParts.map((buf) => buf.toString("base64")),
    mime: "audio/wav",
    wordCount: clean.split(/\s+/).filter(Boolean).length,
    text: clean,
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
  pickSayVoice,
  readSystemVoiceLabel,
  reflowForSpeech,
};
