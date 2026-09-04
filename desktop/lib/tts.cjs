const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PREFERRED_SAY_VOICES = [
  "Zoe (Premium)",
  "Zoe",
  "Ava (Premium)",
  "Ava",
  "Nora (Premium)",
  "Nora",
  "Samantha (Enhanced)",
  "Samantha (Premium)",
  "Samantha",
  "Nicky (Premium)",
  "Allison (Enhanced)",
  "Susan (Enhanced)",
  "Tom (Enhanced)",
  "Alex",
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

async function listSayVoices() {
  if (process.platform !== "darwin") return [];
  try {
    const { stdout } = await execFileAsync("say", ["-v", "?"], {
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((line) => {
        const match = line.match(/^(.+?)\s+[a-z]{2}_[A-Z]{2}/);
        return match ? match[1].trim() : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function pickSayVoice() {
  const available = await listSayVoices();
  if (!available.length) return null;
  for (const preferred of PREFERRED_SAY_VOICES) {
    const hit = available.find(
      (name) => name.toLowerCase() === preferred.toLowerCase(),
    );
    if (hit) return hit;
  }
  // Prefer any Premium / Enhanced English-looking voice.
  const enhanced = available.find((name) =>
    /premium|enhanced|natural/i.test(name),
  );
  return enhanced || available[0];
}

async function synthesizeWithSay(text, voice) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "read-to-me-"));
  const chunks = chunkText(text);
  const wavParts = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const aiffPath = path.join(dir, `part-${i}.aiff`);
    const wavPath = path.join(dir, `part-${i}.wav`);
    const args = [];
    if (voice) args.push("-v", voice);
    // Slightly under default rate reads more naturally for long text.
    args.push("-r", "165");
    args.push("-o", aiffPath, chunks[i]);
    await execFileAsync("say", args);
    // Convert to WAV so Chromium can play it.
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

  // For multi-chunk, concatenate simply by returning array; player plays in order.
  return {
    engine: "macos-say",
    voice: voice || "system",
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

  // Split for API limits.
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
 * Best available natural TTS for this machine.
 * Prefer neural (if keyed), then macOS Premium/Enhanced say voices.
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
    voice: null,
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
