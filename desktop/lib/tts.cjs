const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

/** English-only Premium/Enhanced voices, preferred first. */
const PREFERRED_SAY_VOICES = [
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
  "Victoria",
  "Daniel",
  "Karen",
  "Moira",
  "Fiona",
];

function chunkText(text, maxChars = 1400) {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let rest = clean;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf("\n\n", maxChars);
    if (cut < maxChars * 0.4) cut = rest.lastIndexOf(". ", maxChars);
    if (cut < maxChars * 0.4) cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.4) cut = maxChars;
    const end = cut + (rest[cut] === "." ? 2 : 0);
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
        // "Samantha (Enhanced) en_US    # Hello! ..."
        const match = line.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\b/);
        if (!match) return null;
        return { name: match[1].trim(), locale: match[2] };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function pickSayVoice() {
  const available = await listSayVoices();
  const english = available.filter((v) =>
    v.locale.toLowerCase().startsWith("en_"),
  );

  if (!english.length) {
    // Never fall back to a random first voice (often Italian/French).
    return "Samantha";
  }

  for (const preferred of PREFERRED_SAY_VOICES) {
    const hit = english.find(
      (v) => v.name.toLowerCase() === preferred.toLowerCase(),
    );
    if (hit) return hit.name;
  }

  const enhanced = english.find((v) => /premium|enhanced/i.test(v.name));
  if (enhanced) return enhanced.name;

  const samantha = english.find((v) => /^samantha\b/i.test(v.name));
  if (samantha) return samantha.name;

  return english[0].name;
}

async function synthesizeWithSay(text, voice) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "read-to-me-"));
  const chunks = chunkText(text);
  const wavParts = [];
  const chosen = voice || "Samantha";

  for (let i = 0; i < chunks.length; i += 1) {
    const aiffPath = path.join(dir, `part-${i}.aiff`);
    const wavPath = path.join(dir, `part-${i}.wav`);
    await execFileAsync("say", [
      "-v",
      chosen,
      "-r",
      "170",
      "-o",
      aiffPath,
      chunks[i],
    ]);
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
    wordCount: text.split(/\s+/).filter(Boolean).length,
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
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

/**
 * Prefer neural (if keyed), then an English macOS Premium/Enhanced voice.
 */
async function synthesizeSpeech(text) {
  const clean = text.trim();
  if (!clean) throw new Error("Nothing to speak.");

  try {
    const neural = await synthesizeWithGateway(clean);
    if (neural) return neural;
  } catch (error) {
    console.warn("Neural TTS unavailable, falling back:", error.message);
  }

  if (process.platform === "darwin") {
    const voice = await pickSayVoice();
    return synthesizeWithSay(clean, voice);
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
};
