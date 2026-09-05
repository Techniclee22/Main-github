const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  reflowForSpeech,
  chunkText,
  speakLive,
  prefetchLive,
  stopLiveSay,
  pauseLiveSay,
  resumeLiveSay,
  warmLiveVoice,
  liveDeps,
} = require("../lib/tts.cjs");
const { ENGINE, KOKORO_VOICE_LABEL } = require("../lib/kokoro-live.cjs");

describe("reflowForSpeech", () => {
  it("turns curly quotes into ASCII and keeps contractions", () => {
    const reflowed = reflowForSpeech(`She said \u201Cdon\u2019t\u201D go.`);
    assert.match(reflowed, /don't/);
    assert.match(reflowed, /"/);
  });

  it("joins wrapped lines and glued hyphen breaks", () => {
    const reflowed = reflowForSpeech("This is a wrapped\nline with an exam-\nple.");
    assert.equal(reflowed, "This is a wrapped line with an example.");
  });

  it("does not insert newlines that would pause say", () => {
    const reflowed = reflowForSpeech("One line.\nTwo line.");
    assert.doesNotMatch(reflowed, /\n/);
  });
});

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    assert.deepEqual(chunkText(""), []);
    assert.deepEqual(chunkText("   \n"), []);
  });

  it("keeps short text as a single chunk", () => {
    assert.deepEqual(chunkText("Hello there."), ["Hello there."]);
  });

  it("cuts the first chunk near the opening budget", () => {
    const sentence = "This is a complete sentence used for chunking. ";
    const text = sentence.repeat(20);
    const chunks = chunkText(text, 380, 220);
    assert.ok(chunks.length > 1);
    assert.ok(chunks[0].length <= 230, `first chunk ${chunks[0].length}`);
    assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), reflowForSpeech(text));
  });
});

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function fakePlayers() {
  const spawned = [];
  const signals = [];
  return {
    spawned,
    signals,
    spawn(command, args) {
      const child = new EventEmitter();
      child.pid = 700000 + spawned.length;
      child.killed = false;
      child.command = command;
      child.args = args;
      child.kill = (signal) => {
        child.killed = true;
        setImmediate(() => child.emit("close", null, signal));
      };
      child.finish = () => child.emit("close", 0, null);
      child.fail = (message) => child.emit("error", new Error(message));
      spawned.push(child);
      return child;
    },
    kill(pid, signal) {
      signals.push({ pid, signal });
    },
  };
}

function fakeKokoro(state) {
  const synths = [];
  const demoted = [];
  return {
    synths,
    demoted,
    warmed: 0,
    warmLiveVoice() {
      this.warmed += 1;
    },
    kokoroStatus: () => ({ state, reason: null }),
    synthToWav(text, isCurrent) {
      return new Promise((resolve, reject) => {
        synths.push({ text, isCurrent, resolve, reject });
      });
    },
    demoteKokoro(reason) {
      demoted.push(reason);
      state = "unavailable";
    },
  };
}

function tempWav(name) {
  const file = path.join(os.tmpdir(), `read-to-me-test-${process.pid}-${name}.wav`);
  fs.writeFileSync(file, "RIFF");
  return file;
}

function sayText(child) {
  return fs.readFileSync(child.args[child.args.indexOf("-f") + 1], "utf8");
}

async function withLiveDeps(overrides, run) {
  const previous = { ...liveDeps };
  Object.assign(liveDeps, { platform: "darwin" }, overrides);
  try {
    await run();
  } finally {
    stopLiveSay();
    Object.assign(liveDeps, previous);
  }
}

describe("speakLive engine choice", () => {
  it("speaks with say while Kokoro is not ready and reports that engine", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("warming");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("Hello\nworld.");
      await waitFor(() => players.spawned.length === 1, "say spawn");
      const say = players.spawned[0];
      assert.equal(say.command, "say");
      assert.equal(sayText(say), "Hello world.");
      assert.equal(kokoro.warmed, 1, "speakLive warms Kokoro in the background");
      assert.equal(kokoro.synths.length, 0);

      say.finish();
      const result = await spoken;
      assert.equal(result.engine, ENGINE.SAY);
      assert.equal(result.ok, true);
      assert.equal(result.interrupted, undefined);
      assert.equal(result.wordCount, 2);
      await waitFor(() => !fs.existsSync(say.args[say.args.indexOf("-f") + 1]), "txt unlinked");
    });
  });

  it("synthesizes with Kokoro and plays through afplay when ready", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("Kokoro speaks.");
      await waitFor(() => kokoro.synths.length === 1, "synth request");
      assert.equal(kokoro.synths[0].text, "Kokoro speaks.");
      const wav = tempWav("ready");
      kokoro.synths[0].resolve(wav);

      await waitFor(() => players.spawned.length === 1, "afplay spawn");
      const player = players.spawned[0];
      assert.equal(player.command, "afplay");
      assert.deepEqual(player.args, [wav]);
      player.finish();

      const result = await spoken;
      assert.equal(result.engine, ENGINE.KOKORO);
      assert.equal(result.voice, KOKORO_VOICE_LABEL);
      await waitFor(() => !fs.existsSync(wav), "wav unlinked after play");
    });
  });

  it("stays off Kokoro away from darwin even when ready", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps(
      { spawn: players.spawn, kill: players.kill, kokoro, platform: "linux" },
      async () => {
        const spoken = speakLive("Linux.");
        await waitFor(() => players.spawned.length === 1, "say spawn");
        assert.equal(players.spawned[0].command, "say");
        assert.equal(players.spawned[0].args[0], "-v");
        assert.equal(kokoro.synths.length, 0);
        players.spawned[0].finish();
        assert.equal((await spoken).engine, ENGINE.SAY);
      },
    );
  });

  it("pipelines the next piece while the current one plays", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    const text = "This sentence keeps going with more clauses to split. ".repeat(12);
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive(text);
      let pipelined = 0;
      for (let i = 0; ; i += 1) {
        await waitFor(() => kokoro.synths.length >= i + 1, `synth ${i}`);
        kokoro.synths[i].resolve(tempWav(`p${i}`));
        await waitFor(() => players.spawned.length === i + 1, `player ${i}`);
        assert.equal(players.spawned[i].command, "afplay");
        const nextRequested = kokoro.synths.length === i + 2;
        if (nextRequested) pipelined += 1;
        players.spawned[i].finish();
        if (!nextRequested) break;
      }
      const result = await spoken;
      assert.equal(result.engine, ENGINE.KOKORO);
      assert.ok(kokoro.synths.length >= 3, `pieces: ${kokoro.synths.length}`);
      assert.equal(pipelined, kokoro.synths.length - 1, "every next piece was requested mid-play");
      assert.ok(kokoro.synths[0].text.length <= 190, `first piece ${kokoro.synths[0].text.length}`);
      assert.equal(
        kokoro.synths.map((s) => s.text).join(" "),
        reflowForSpeech(text),
        "pieces cover the whole sentence in order",
      );
      assert.equal(players.spawned.length, kokoro.synths.length);
    });
  });
});

describe("pause latch across the synth gap", () => {
  it("pause returns false when nothing is speaking", () => {
    stopLiveSay();
    assert.equal(pauseLiveSay(), false);
    assert.equal(resumeLiveSay(), false);
  });

  it("latches while Kokoro is still synthesizing and gates the player", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("Wait for me.");
      assert.equal(pauseLiveSay(), true, "pause latches with no child yet");
      assert.equal(pauseLiveSay(), false, "already paused");
      assert.deepEqual(players.signals, [], "no pid to signal");

      await waitFor(() => kokoro.synths.length === 1, "synth request");
      kokoro.synths[0].resolve(tempWav("gate"));
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(players.spawned.length, 0, "player waits for resume");

      assert.equal(resumeLiveSay(), true);
      await waitFor(() => players.spawned.length === 1, "afplay after resume");
      const player = players.spawned[0];

      assert.equal(pauseLiveSay(), true);
      assert.deepEqual(players.signals, [{ pid: -player.pid, signal: "SIGKILL" }]);
      await waitFor(() => player.killed, "afplay torn down for silence");

      assert.equal(resumeLiveSay(), true);
      await waitFor(() => players.spawned.length === 2, "afplay replay after resume");
      players.spawned[1].finish();
      assert.equal((await spoken).engine, ENGINE.KOKORO);
      assert.equal(pauseLiveSay(), false, "seat released after the sentence");
    });
  });

  it("stop during the synth gap resolves interrupted and spawns nothing", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("Cut short.");
      await waitFor(() => kokoro.synths.length === 1, "synth request");
      stopLiveSay();
      assert.equal(kokoro.synths[0].isCurrent(), false, "supervisor sees the stale generation");
      const wav = tempWav("stale");
      kokoro.synths[0].resolve(wav);

      const result = await spoken;
      assert.deepEqual(
        { ok: result.ok, interrupted: result.interrupted, engine: result.engine },
        { ok: true, interrupted: true, engine: ENGINE.KOKORO },
      );
      assert.equal(players.spawned.length, 0);
      await waitFor(() => !fs.existsSync(wav), "late wav unlinked");
    });
  });

  it("stop mid-play unlinks the piece already synthesized for later", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    const text = "This sentence keeps going with more clauses to split. ".repeat(12);
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive(text);
      await waitFor(() => kokoro.synths.length === 1, "first synth");
      const playing = tempWav("playing");
      kokoro.synths[0].resolve(playing);
      await waitFor(() => players.spawned.length === 1, "afplay for piece 0");
      await waitFor(() => kokoro.synths.length === 2, "look-ahead synth");
      const ahead = tempWav("ahead");
      kokoro.synths[1].resolve(ahead);
      assert.equal(players.spawned.length, 1, "piece 1 is ready while piece 0 still plays");

      stopLiveSay();
      const result = await spoken;
      assert.equal(result.interrupted, true);
      assert.equal(players.spawned[0].killed, true);
      assert.equal(players.spawned.length, 1);
      await waitFor(() => !fs.existsSync(playing), "playing wav unlinked");
      await waitFor(() => !fs.existsSync(ahead), "look-ahead wav unlinked");
    });
  });

  it("stop while paused in the gap releases the waiter", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("Paused then stopped.");
      pauseLiveSay();
      await waitFor(() => kokoro.synths.length === 1, "synth request");
      const wav = tempWav("paused-stop");
      kokoro.synths[0].resolve(wav);
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
      stopLiveSay();
      const result = await spoken;
      assert.equal(result.interrupted, true);
      assert.equal(players.spawned.length, 0);
      await waitFor(() => !fs.existsSync(wav), "paused wav unlinked");
    });
  });
});

describe("prefetchLive", () => {
  it("hides the next-sentence synth wait when prefetch matches", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      assert.equal(prefetchLive("Next sentence.").ok, true);
      await waitFor(() => kokoro.synths.length === 1, "prefetch synth");
      assert.equal(kokoro.synths[0].text, "Next sentence.");
      const wav = tempWav("prefetch");
      kokoro.synths[0].resolve(wav);

      const spoken = speakLive("Next sentence.");
      await waitFor(() => players.spawned.length === 1, "afplay without a second synth");
      assert.equal(kokoro.synths.length, 1, "speakLive reused the prefetch synth");
      assert.equal(players.spawned[0].command, "afplay");
      players.spawned[0].finish();
      assert.equal((await spoken).engine, ENGINE.KOKORO);
    });
  });

  it("clears a next-sentence prefetch that starts before speakLive", async () => {
    // Pill used to call prefetchLive(N+1) before speakLive(N). speakLive(N)
    // clears any non-matching prefetch, so every sentence paid a cold synth.
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      assert.equal(prefetchLive("Second sentence.").ok, true);
      await waitFor(() => kokoro.synths.length === 1, "prefetch B");
      const spokenA = speakLive("First sentence.");
      await waitFor(() => kokoro.synths.length === 2, "cold synth for A after clearing B");
      kokoro.synths[1].resolve(tempWav("a"));
      await waitFor(() => players.spawned.length === 1, "afplay A");
      players.spawned[0].finish();
      await spokenA;

      const spokenB = speakLive("Second sentence.");
      await waitFor(() => kokoro.synths.length === 3, "B must synth again");
      kokoro.synths[2].resolve(tempWav("b-again"));
      await waitFor(() => players.spawned.length === 2, "afplay B");
      players.spawned[1].finish();
      await spokenB;
    });
  });

  it("reuses the next sentence when prefetch starts after speakLive begins", async () => {
    // Correct pill order: start speakLive(N), then prefetchLive(N+1), await N.
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spokenA = speakLive("First sentence.");
      await waitFor(() => kokoro.synths.length === 1, "synth A");
      assert.equal(prefetchLive("Second sentence.").ok, true);
      await waitFor(() => kokoro.synths.length === 2, "prefetch B while A synths");
      kokoro.synths[0].resolve(tempWav("a"));
      await waitFor(() => players.spawned.length === 1, "afplay A");
      // Finish B's synth while A is still playing — the overlap the ear needs.
      kokoro.synths[1].resolve(tempWav("b"));
      players.spawned[0].finish();
      await spokenA;

      const spokenB = speakLive("Second sentence.");
      await waitFor(() => players.spawned.length === 2, "afplay B without a third synth");
      assert.equal(kokoro.synths.length, 2, "speakLive reused the overlapping prefetch");
      players.spawned[1].finish();
      assert.equal((await spokenB).engine, ENGINE.KOKORO);
    });
  });

  it("stopLiveSay drops a pending prefetch", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      prefetchLive("Abandoned.");
      await waitFor(() => kokoro.synths.length === 1, "prefetch synth");
      const wav = tempWav("abandon");
      stopLiveSay();
      kokoro.synths[0].resolve(wav);
      await waitFor(() => !fs.existsSync(wav), "prefetch wav unlinked");

      const spoken = speakLive("Abandoned.");
      await waitFor(() => kokoro.synths.length === 2, "fresh synth after stop");
      kokoro.synths[1].resolve(tempWav("fresh"));
      await waitFor(() => players.spawned.length === 1, "afplay");
      players.spawned[0].finish();
      await spoken;
    });
  });
});

describe("speakLive demotion", () => {
  it("re-speaks the same sentence with say when Kokoro synth fails", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("Fall back please.");
      await waitFor(() => kokoro.synths.length === 1, "synth request");
      kokoro.synths[0].reject(Object.assign(new Error("phonemizer"), { code: "error" }));

      await waitFor(() => players.spawned.length === 1, "say spawn");
      const say = players.spawned[0];
      assert.equal(say.command, "say");
      assert.equal(sayText(say), "Fall back please.");
      say.finish();

      const result = await spoken;
      assert.equal(result.engine, ENGINE.SAY);
      assert.equal(result.interrupted, undefined);
    });
  });

  it("demotes Kokoro for the session when afplay cannot start", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("ready");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("No player here.");
      await waitFor(() => kokoro.synths.length === 1, "synth request");
      kokoro.synths[0].resolve(tempWav("noplayer"));
      await waitFor(() => players.spawned.length === 1, "afplay spawn");
      players.spawned[0].fail("spawn afplay ENOENT");

      await waitFor(() => players.spawned.length === 2, "say spawn");
      assert.equal(players.spawned[1].command, "say");
      assert.match(kokoro.demoted[0], /afplay failed/);
      players.spawned[1].finish();
      assert.equal((await spoken).engine, ENGINE.SAY);
      assert.equal(kokoro.kokoroStatus().state, "unavailable");
    });
  });

  it("throws only when no engine can speak, and releases the seat", async () => {
    const players = fakePlayers();
    const kokoro = fakeKokoro("unavailable");
    await withLiveDeps({ spawn: players.spawn, kill: players.kill, kokoro }, async () => {
      const spoken = speakLive("Silence.");
      await waitFor(() => players.spawned.length === 1, "say spawn");
      players.spawned[0].fail("spawn say ENOENT");
      await assert.rejects(spoken, /ENOENT/);
      assert.equal(pauseLiveSay(), false);
    });
  });

  it("warmLiveVoice re-exports the supervisor warmup", async () => {
    const kokoro = fakeKokoro("cold");
    await withLiveDeps({ kokoro }, async () => {
      warmLiveVoice();
      assert.equal(kokoro.warmed, 1);
    });
  });
});
