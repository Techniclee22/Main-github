/**
 * The worker is spawned as a plain `node` so ONNX Runtime's native binding
 * loads against Node's ABI, not Electron's.
 */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const ENGINE = Object.freeze({
  KOKORO: "kokoro-live",
  SAY: "macos-say-live",
});

const KOKORO_VOICE = "af_heart";
const KOKORO_VOICE_LABEL = "Heart (Kokoro)";
const WORKER_PATH = path.join(__dirname, "kokoro-worker.cjs");
const SYNTH_TIMEOUT_MS = 30_000;
const FORCE_SAY_ENV = "READ_TO_ME_FORCE_SAY";

function forceSayRequested(env = process.env) {
  return Boolean(env[FORCE_SAY_ENV]);
}

function selectVoice(state, { forceSay = false, platform = process.platform } = {}) {
  if (platform !== "darwin" || forceSay || state !== "ready") return ENGINE.SAY;
  return ENGINE.KOKORO;
}

function parseWorkerLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (!message || typeof message !== "object") return null;
  if (!Number.isInteger(message.id) || typeof message.ok !== "boolean") {
    return null;
  }
  return message;
}

function nodeCommand({
  env = process.env,
  execPath = process.execPath,
  versions = process.versions,
} = {}) {
  if (env.READ_TO_ME_NODE) return env.READ_TO_ME_NODE;
  if (!versions.electron) return execPath;
  return "node";
}

class KokoroFailure extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "KokoroFailure";
    this.code = code;
  }
}

function createKokoroSupervisor({
  spawn: spawnChild = spawn,
  platform = process.platform,
  env = process.env,
  workerPath = WORKER_PATH,
  tmpdir = os.tmpdir(),
  synthTimeoutMs = SYNTH_TIMEOUT_MS,
  warn = (message) => console.warn(message),
} = {}) {
  let state = "cold";
  let reason = null;
  let proc = null;
  let nextId = 1;
  const pending = new Map();

  function kokoroStatus() {
    return { state, reason };
  }

  function settleAll(reply) {
    for (const [id, waiter] of pending) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve({ id, ...reply });
    }
    pending.clear();
  }

  function demoteKokoro(why) {
    const wasLive = state === "warming" || state === "ready";
    state = "unavailable";
    reason = why;
    settleAll({ ok: false, code: "worker-gone" });
    const dying = proc;
    proc = null;
    if (dying) {
      try {
        dying.stdin?.end();
        dying.kill();
      } catch {}
    }
    if (wasLive) warn(`Kokoro unavailable (${why}); Read uses say.`);
  }

  function request(message, timeoutMs) {
    return new Promise((resolve) => {
      if (!proc) {
        resolve({ ok: false, code: "worker-gone" });
        return;
      }
      const id = nextId;
      nextId += 1;
      const timer = timeoutMs
        ? setTimeout(() => {
            pending.delete(id);
            resolve({ id, ok: false, code: "timeout" });
            demoteKokoro(`${message.op} timed out after ${timeoutMs}ms`);
          }, timeoutMs)
        : null;
      pending.set(id, { resolve, timer });
      proc.stdin.write(`${JSON.stringify({ id, ...message })}\n`);
    });
  }

  function onWorkerLine(line) {
    const reply = parseWorkerLine(line);
    if (!reply) return;
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (waiter.timer) clearTimeout(waiter.timer);
    waiter.resolve(reply);
  }

  function warmLiveVoice() {
    if (state !== "cold") return;
    if (platform !== "darwin") {
      state = "unavailable";
      reason = "not-darwin";
      return;
    }
    if (forceSayRequested(env)) {
      state = "unavailable";
      reason = "forced-say";
      return;
    }

    state = "warming";
    let child;
    try {
      child = spawnChild(nodeCommand({ env }), [workerPath], {
        stdio: ["pipe", "pipe", "inherit"],
        env,
      });
    } catch (error) {
      demoteKokoro(`spawn failed: ${error.message}`);
      return;
    }
    proc = child;
    child.on("error", (error) => {
      if (proc === child) demoteKokoro(`worker error: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (proc === child) demoteKokoro(`worker exited (${signal || code})`);
    });
    // A worker that dies mid-write must not surface EPIPE as an uncaught error.
    child.stdin.on("error", () => {});
    readline
      .createInterface({ input: child.stdout, crlfDelay: Infinity })
      .on("line", onWorkerLine);
    // The app must be able to quit with the worker still resident; closing
    // stdin on exit is what ends the worker.
    child.unref?.();
    child.stdin.unref?.();
    child.stdout.unref?.();

    void request({ op: "warm" }, 0).then((reply) => {
      if (proc !== child) return;
      if (reply.ok) {
        state = "ready";
        reason = null;
        return;
      }
      demoteKokoro(reply.code || "warm failed");
    });
  }

  async function synthToWav(text, isCurrent = () => true) {
    if (state !== "ready" || !proc) throw new KokoroFailure("not-ready", reason);
    if (!isCurrent()) throw new KokoroFailure("interrupted");
    const out = path.join(
      tmpdir,
      `read-to-me-kokoro-${process.pid}-${Date.now()}-${nextId}.wav`,
    );
    const reply = await request(
      { op: "synth", text, voice: KOKORO_VOICE, out },
      synthTimeoutMs,
    );
    if (!reply.ok) {
      void fs.promises.unlink(out).catch(() => {});
      throw new KokoroFailure(reply.code || "error", reply.error);
    }
    if (!isCurrent()) {
      void fs.promises.unlink(out).catch(() => {});
      throw new KokoroFailure("interrupted");
    }
    return out;
  }

  return { warmLiveVoice, kokoroStatus, synthToWav, demoteKokoro };
}

const { warmLiveVoice, kokoroStatus, synthToWav, demoteKokoro } =
  createKokoroSupervisor();

module.exports = {
  ENGINE,
  KOKORO_VOICE,
  KOKORO_VOICE_LABEL,
  KokoroFailure,
  createKokoroSupervisor,
  demoteKokoro,
  forceSayRequested,
  kokoroStatus,
  nodeCommand,
  parseWorkerLine,
  selectVoice,
  synthToWav,
  warmLiveVoice,
};
