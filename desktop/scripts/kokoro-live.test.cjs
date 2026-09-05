const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const {
  ENGINE,
  KOKORO_VOICE,
  createKokoroSupervisor,
  nodeCommand,
  parseWorkerLine,
  selectVoice,
} = require("../lib/kokoro-live.cjs");

const LIB_DIR = path.join(__dirname, "..", "lib");
const WORKER_PATH = path.join(LIB_DIR, "kokoro-worker.cjs");

const kokoroInstalled = (() => {
  try {
    require.resolve("kokoro-js", {
      paths: [LIB_DIR, path.join(os.homedir(), ".read-to-me")],
    });
    return true;
  } catch {
    return false;
  }
})();

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function fakeWorker() {
  const child = new EventEmitter();
  child.pid = 424242;
  child.killed = false;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.requests = [];
  child.kill = () => {
    child.killed = true;
  };
  child.unref = () => {};

  const waiting = [];
  let cursor = 0;
  const take = (resolve) => {
    if (child.requests.length > cursor) {
      resolve(child.requests[cursor]);
      cursor += 1;
      return true;
    }
    return false;
  };
  readline.createInterface({ input: child.stdin }).on("line", (line) => {
    child.requests.push(JSON.parse(line));
    while (waiting.length && take(waiting[0])) waiting.shift();
  });
  child.nextRequest = () =>
    new Promise((resolve) => {
      if (!take(resolve)) waiting.push(resolve);
    });
  child.reply = (body) => {
    child.stdout.write(`${JSON.stringify(body)}\n`);
  };
  return child;
}

function supervisorWithFakeWorker(options = {}) {
  const children = [];
  const supervisor = createKokoroSupervisor({
    spawn: (command, args) => {
      const child = fakeWorker();
      child.command = command;
      child.args = args;
      children.push(child);
      return child;
    },
    platform: "darwin",
    env: {},
    warn() {},
    ...options,
  });
  return { supervisor, children };
}

async function warmToReady({ supervisor, children }) {
  supervisor.warmLiveVoice();
  const child = children[0];
  const warm = await child.nextRequest();
  assert.equal(warm.op, "warm");
  child.reply({ id: warm.id, ok: true, sampleRate: 24000 });
  await waitFor(() => supervisor.kokoroStatus().state === "ready", "ready");
  return child;
}

describe("selectVoice", () => {
  it("speaks with say unless Kokoro is ready on darwin", () => {
    for (const state of ["cold", "warming", "unavailable"]) {
      assert.equal(selectVoice(state, { platform: "darwin" }), ENGINE.SAY);
    }
    assert.equal(selectVoice("ready", { platform: "darwin" }), ENGINE.KOKORO);
  });

  it("never picks Kokoro off darwin or when say is forced", () => {
    assert.equal(selectVoice("ready", { platform: "linux" }), ENGINE.SAY);
    assert.equal(
      selectVoice("ready", { platform: "darwin", forceSay: true }),
      ENGINE.SAY,
    );
  });
});

describe("parseWorkerLine", () => {
  it("returns null for anything that is not a reply", () => {
    assert.equal(parseWorkerLine("not json"), null);
    assert.equal(parseWorkerLine("42"), null);
    assert.equal(parseWorkerLine('{"id":"1","ok":true}'), null);
    assert.equal(parseWorkerLine('{"id":1}'), null);
  });

  it("returns the reply object for a well formed line", () => {
    assert.deepEqual(parseWorkerLine('{"id":7,"ok":false,"code":"needs-model"}'), {
      id: 7,
      ok: false,
      code: "needs-model",
    });
  });
});

describe("nodeCommand", () => {
  it("prefers READ_TO_ME_NODE, then the running node, then PATH node under Electron", () => {
    assert.equal(
      nodeCommand({ env: { READ_TO_ME_NODE: "/opt/node" }, versions: {} }),
      "/opt/node",
    );
    assert.equal(
      nodeCommand({ env: {}, execPath: "/usr/bin/node", versions: {} }),
      "/usr/bin/node",
    );
    assert.equal(
      nodeCommand({
        env: {},
        execPath: "/Applications/Electron",
        versions: { electron: "37.0.0" },
      }),
      "node",
    );
  });
});

describe("createKokoroSupervisor", () => {
  it("stays unavailable off darwin and when say is forced, without spawning", () => {
    const linux = supervisorWithFakeWorker({ platform: "linux" });
    linux.supervisor.warmLiveVoice();
    assert.deepEqual(linux.supervisor.kokoroStatus(), {
      state: "unavailable",
      reason: "not-darwin",
    });
    assert.equal(linux.children.length, 0);

    const forced = supervisorWithFakeWorker({ env: { READ_TO_ME_FORCE_SAY: "1" } });
    forced.supervisor.warmLiveVoice();
    assert.equal(forced.supervisor.kokoroStatus().reason, "forced-say");
    assert.equal(forced.children.length, 0);
  });

  it("warms once through the handshake and synthesizes under tmpdir", async () => {
    const fixture = supervisorWithFakeWorker();
    const { supervisor, children } = fixture;
    assert.deepEqual(supervisor.kokoroStatus(), { state: "cold", reason: null });

    supervisor.warmLiveVoice();
    supervisor.warmLiveVoice();
    assert.equal(children.length, 1, "warm is idempotent");
    assert.equal(children[0].command, process.execPath);
    assert.deepEqual(children[0].args, [WORKER_PATH]);
    assert.equal(supervisor.kokoroStatus().state, "warming");

    const child = children[0];
    const warm = await child.nextRequest();
    assert.deepEqual(warm, { id: 1, op: "warm" });
    child.reply({ id: 1, ok: true, sampleRate: 24000 });
    await waitFor(() => supervisor.kokoroStatus().state === "ready", "ready");

    const synth = supervisor.synthToWav("Hello there.");
    const request = await child.nextRequest();
    assert.equal(request.op, "synth");
    assert.equal(request.text, "Hello there.");
    assert.equal(request.voice, KOKORO_VOICE);
    assert.ok(
      request.out.startsWith(`${os.tmpdir()}${path.sep}`),
      `wav path under tmpdir: ${request.out}`,
    );
    child.reply({ id: request.id, ok: true, path: request.out });
    assert.equal(await synth, request.out);
  });

  it("unlinks a synth result that lands after the utterance was stopped", async () => {
    const fixture = supervisorWithFakeWorker();
    const child = await warmToReady(fixture);

    let current = true;
    const synth = fixture.supervisor.synthToWav("Late.", () => current);
    const request = await child.nextRequest();
    fs.writeFileSync(request.out, "RIFF");
    current = false;
    child.reply({ id: request.id, ok: true, path: request.out });

    await assert.rejects(synth, (error) => error.code === "interrupted");
    await waitFor(() => !fs.existsSync(request.out), "stale wav unlinked");
  });

  it("surfaces a synth failure by code and stays ready", async () => {
    const fixture = supervisorWithFakeWorker();
    const child = await warmToReady(fixture);

    const synth = fixture.supervisor.synthToWav("Odd text");
    const request = await child.nextRequest();
    child.reply({ id: request.id, ok: false, code: "error", error: "phonemes" });

    await assert.rejects(synth, (error) => error.code === "error");
    assert.equal(fixture.supervisor.kokoroStatus().state, "ready");
  });

  it("goes unavailable when the worker has no module, and kills it", async () => {
    const { supervisor, children } = supervisorWithFakeWorker();
    supervisor.warmLiveVoice();
    const child = children[0];
    const warm = await child.nextRequest();
    child.reply({ id: warm.id, ok: false, code: "needs-module" });

    await waitFor(() => supervisor.kokoroStatus().state === "unavailable", "unavailable");
    assert.equal(supervisor.kokoroStatus().reason, "needs-module");
    assert.equal(child.killed, true);
    await assert.rejects(supervisor.synthToWav("x"), (error) => error.code === "not-ready");
  });

  it("goes unavailable when the worker exits, failing in-flight synth", async () => {
    const fixture = supervisorWithFakeWorker();
    const child = await warmToReady(fixture);

    const synth = fixture.supervisor.synthToWav("Crash.");
    await child.nextRequest();
    child.emit("exit", 1, null);

    await assert.rejects(synth, (error) => error.code === "worker-gone");
    assert.equal(fixture.supervisor.kokoroStatus().state, "unavailable");
    assert.match(fixture.supervisor.kokoroStatus().reason, /worker exited/);
  });

  it("demotes on a synth timeout", async () => {
    const fixture = supervisorWithFakeWorker({ synthTimeoutMs: 5 });
    const child = await warmToReady(fixture);

    const synth = fixture.supervisor.synthToWav("Slow.");
    await child.nextRequest();

    await assert.rejects(synth, (error) => error.code === "timeout");
    assert.equal(fixture.supervisor.kokoroStatus().state, "unavailable");
    assert.equal(child.killed, true);
  });

  it("demoteKokoro is an explicit unavailable transition", async () => {
    const fixture = supervisorWithFakeWorker();
    const child = await warmToReady(fixture);
    fixture.supervisor.demoteKokoro("afplay failed");
    assert.deepEqual(fixture.supervisor.kokoroStatus(), {
      state: "unavailable",
      reason: "afplay failed",
    });
    assert.equal(child.killed, true);
  });
});

function runWorker(lines) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER_PATH], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const replies = [];
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      replies.push(JSON.parse(line));
      if (replies.length === lines.length) child.stdin.end();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, replies }));
    child.stdin.write(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  });
}

describe("kokoro-worker.cjs", () => {
  it("validates requests before touching the model", async () => {
    const { code, replies } = await runWorker([
      { id: 1, op: "synth", text: "hi", voice: KOKORO_VOICE, out: "/etc/x.wav" },
      { id: 2, op: "synth", text: "hi", voice: "am_adam", out: path.join(os.tmpdir(), "x.wav") },
      { id: 3, op: "synth", text: "", voice: KOKORO_VOICE, out: path.join(os.tmpdir(), "x.wav") },
      { id: 4, op: "synth", text: "hi", voice: KOKORO_VOICE, out: path.join(os.tmpdir(), "x.wav") },
      { id: 5, op: "dance" },
    ]);
    assert.equal(code, 0);
    assert.deepEqual(
      replies.map((reply) => [reply.id, reply.ok, reply.code]),
      [
        [1, false, "bad-request"],
        [2, false, "bad-request"],
        [3, false, "bad-request"],
        [4, false, "not-warm"],
        [5, false, "bad-request"],
      ],
    );
  });

  it(
    "answers needs-module when kokoro-js is not installed",
    { skip: kokoroInstalled && "kokoro-js is installed here" },
    async () => {
      const { code, replies } = await runWorker([{ id: 1, op: "warm" }]);
      assert.equal(code, 0);
      assert.equal(replies[0].ok, false);
      assert.equal(replies[0].code, "needs-module");
    },
  );

  it(
    "warms the real model and writes a WAV",
    {
      skip:
        !(process.env.READ_TO_ME_KOKORO_SMOKE && kokoroInstalled) &&
        "set READ_TO_ME_KOKORO_SMOKE=1 with kokoro-js installed",
      timeout: 10 * 60 * 1000,
    },
    async () => {
      const out = path.join(os.tmpdir(), `read-to-me-smoke-${process.pid}.wav`);
      const { replies } = await runWorker([
        { id: 1, op: "warm" },
        { id: 2, op: "synth", text: "Kokoro is speaking.", voice: KOKORO_VOICE, out },
      ]);
      assert.deepEqual(replies[0], { id: 1, ok: true, sampleRate: 24000 });
      assert.deepEqual(replies[1], { id: 2, ok: true, path: out });
      const wav = fs.readFileSync(out);
      fs.unlinkSync(out);
      assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
      assert.equal(wav.readUInt16LE(20), 1, "PCM");
      assert.equal(wav.readUInt16LE(22), 1, "mono");
      assert.equal(wav.readUInt32LE(24), 24000);
      assert.equal(wav.readUInt16LE(34), 16);
    },
  );
});
