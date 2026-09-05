#!/usr/bin/env node
/**
 * Kokoro synthesis worker. Spawned by lib/kokoro-live.cjs as a plain `node`
 * process; never required by the app. Speaks newline-delimited JSON on stdio:
 *
 *   -> { id, op: "warm" }
 *   <- { id, ok: true, sampleRate: 24000 }
 *   <- { id, ok: false, code: "needs-module" | "needs-model" | "error", error? }
 *   -> { id, op: "synth", text, voice: "af_heart", out }
 *   <- { id, ok: true, path } | { id, ok: false, code, error? }
 *   -> { id, op: "bye" }
 *
 * The host owns every path it sends. This process only writes under os.tmpdir().
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";
const SAMPLE_RATE = 24000;
const MAX_TEXT_CHARS = 2000;
const USER_MODULES_ROOT = path.join(os.homedir(), ".read-to-me");

/** @type {import("kokoro-js").KokoroTTS | null} */
let tts = null;

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function underTmpdir(candidate) {
  const tmp = path.resolve(os.tmpdir());
  const resolved = path.resolve(candidate);
  return resolved.startsWith(`${tmp}${path.sep}`);
}

function validateRequest(message) {
  if (!message || typeof message !== "object" || !Number.isInteger(message.id)) {
    return { error: "id must be an integer" };
  }
  const { id, op } = message;
  if (op === "warm" || op === "bye") return { request: { id, op } };
  if (op !== "synth") return { id, error: `unknown op ${JSON.stringify(op)}` };

  const { text, voice, out } = message;
  if (typeof text !== "string" || !text.trim()) {
    return { id, error: "text must be a non-empty string" };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { id, error: `text longer than ${MAX_TEXT_CHARS} chars` };
  }
  if (voice !== VOICE) return { id, error: `voice must be ${VOICE}` };
  if (typeof out !== "string" || !underTmpdir(out)) {
    return { id, error: "out must be a path under os.tmpdir()" };
  }
  return { request: { id, op, text, out: path.resolve(out) } };
}

function loadKokoro() {
  const resolved = require.resolve("kokoro-js", {
    paths: [__dirname, USER_MODULES_ROOT],
  });
  return require(resolved);
}

async function warm() {
  if (tts) return { ok: true, sampleRate: SAMPLE_RATE };

  let KokoroTTS;
  try {
    ({ KokoroTTS } = loadKokoro());
  } catch (error) {
    const code = error?.code === "MODULE_NOT_FOUND" ? "needs-module" : "error";
    return { ok: false, code, error: error?.message };
  }

  let announced = false;
  try {
    tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "cpu",
      progress_callback: (event) => {
        if (announced || event?.status !== "initiate") return;
        announced = true;
        process.stderr.write(
          `Kokoro: loading ${MODEL_ID} (the first launch downloads the weights)\n`,
        );
      },
    });
  } catch (error) {
    return { ok: false, code: "needs-model", error: error?.message };
  }
  return { ok: true, sampleRate: SAMPLE_RATE };
}

// kokoro-js saves IEEE-float WAV. afplay on macOS wants integer PCM.
function writePcm16Wav(floatSamples, sampleRate, outPath) {
  const samples = floatSamples.length;
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const clipped = Math.max(-1, Math.min(1, floatSamples[i]));
    buf.writeInt16LE(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, 44 + i * 2);
  }
  fs.writeFileSync(outPath, buf);
}

async function synth({ text, out }) {
  if (!tts) return { ok: false, code: "not-warm" };
  try {
    const audio = await tts.generate(text, { voice: VOICE });
    const samples = audio?.audio;
    const rate = audio?.sampling_rate || SAMPLE_RATE;
    if (!samples || typeof samples.length !== "number") {
      return { ok: false, code: "error", error: "synth returned no samples" };
    }
    writePcm16Wav(samples, rate, out);
    return { ok: true, path: out };
  } catch (error) {
    return { ok: false, code: "error", error: error?.message };
  }
}

async function handle(line) {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    reply({ id: null, ok: false, code: "bad-request", error: error.message });
    return;
  }

  const { request, id = null, error } = validateRequest(message);
  if (!request) {
    reply({ id, ok: false, code: "bad-request", error });
    return;
  }
  if (request.op === "bye") {
    process.exit(0);
  }
  const result = request.op === "warm" ? await warm() : await synth(request);
  reply({ id: request.id, ...result });
}

let queue = Promise.resolve();
const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
input.on("line", (line) => {
  queue = queue
    .then(() => handle(line))
    .catch((error) => {
      reply({ id: null, ok: false, code: "error", error: error?.message });
    });
});
input.on("close", () => {
  void queue.then(() => process.exit(0));
});
