(() => {
  const pickBtn = document.getElementById("pickBtn");
  const readBtn = document.getElementById("readBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const stopBtn = document.getElementById("stopBtn");
  const picker = document.getElementById("picker");
  const pickerList = document.getElementById("pickerList");
  const refreshBtn = document.getElementById("refreshBtn");
  const targetLabel = document.getElementById("targetLabel");
  const statusEl = document.getElementById("status");
  const pill = document.getElementById("pill");

  let selected = { id: null, name: null };
  let pickerOpen = false;
  let reading = false;
  // True only after an explicit picker choice — next Read uses that window once.
  let forceSelected = false;

  /** @type {ReturnType<typeof setInterval> | null} */
  let followTimer = null;
  let followGeneration = 0;
  let lastContentHash = null;
  let pendingHash = null;
  let pendingStable = 0;
  let followActive = false;
  let followBusy = false;

  const speech = window.ReadToMeSpeech.create({
    onState(state) {
      applyPlaybackUi(state);
      if (state === "idle" && !reading && !followActive) {
        stopFollow();
      }
    },
    onVoiceInfo(info) {
      if (info?.voice) setStatus(`Voice: ${info.voice}`);
    },
  });

  function setStatus(message) {
    statusEl.textContent = message || "";
  }

  function applyPlaybackUi(state) {
    if (state && typeof state === "object") return;
    const speaking = state === "speaking";
    const paused = state === "paused";
    const playbackBusy = speaking || paused;
    // Keep Stop available while scroll-follow is on, even between pages.
    pauseBtn.hidden = !speaking;
    resumeBtn.hidden = !paused;
    stopBtn.hidden = !(playbackBusy || followActive);
    readBtn.hidden = playbackBusy;
    if (!playbackBusy && !reading) {
      readBtn.disabled = false;
    }
  }

  function stopFollow() {
    followActive = false;
    followGeneration += 1;
    if (followTimer) {
      clearInterval(followTimer);
      followTimer = null;
    }
    pendingHash = null;
    pendingStable = 0;
    applyPlaybackUi(
      speech.speaking ? "speaking" : speech.paused ? "paused" : "idle",
    );
  }

  function textFingerprint(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .slice(0, 400);
  }

  function textsDifferEnough(a, b) {
    const left = textFingerprint(a);
    const right = textFingerprint(b);
    if (!left || !right) return true;
    if (left === right) return false;
    // Cheap overlap check on leading words.
    const aw = left.split(" ").slice(0, 40);
    const bw = new Set(right.split(" ").slice(0, 40));
    let overlap = 0;
    for (const word of aw) {
      if (bw.has(word)) overlap += 1;
    }
    const ratio = overlap / Math.max(aw.length, 1);
    return ratio < 0.55;
  }

  async function speakTextStreaming(text, { statusPrefix } = {}) {
    const plan = await window.readToMe.planSpeech(text);
    if (!plan.text && !plan.chunks?.length) throw new Error("Nothing to speak.");

    setStatus(
      statusPrefix ||
        `Speaking with your system voice (${plan.voice})…`,
    );

    // Live macOS `say`: audio starts immediately — no WAV render wait.
    if (plan.engine === "macos-say-live") {
      await speech.speakLive(plan.text || plan.chunks[0]);
      return;
    }

    const cache = new Map();
    const fetchChunk = (index) => {
      if (cache.has(index)) return cache.get(index);
      const pending = window.readToMe.synthesizeSpeechChunk(
        plan.chunks[index],
        plan.voice,
      );
      cache.set(index, pending);
      return pending;
    };

    void fetchChunk(0);
    if (plan.chunks.length > 1) void fetchChunk(1);

    await speech.speakStream({
      chunkCount: plan.chunks.length,
      async getChunk(index) {
        if (index + 2 < plan.chunks.length) void fetchChunk(index + 2);
        return fetchChunk(index);
      },
    });
  }

  function startFollow(windowId, seedText) {
    stopFollow();
    if (!windowId) return;

    followActive = true;
    applyPlaybackUi(
      speech.speaking ? "speaking" : speech.paused ? "paused" : "idle",
    );
    const generation = followGeneration;
    let currentText = seedText || "";
    lastContentHash = null;
    pendingHash = null;
    pendingStable = 0;

    followTimer = setInterval(() => {
      void (async () => {
        if (generation !== followGeneration || !followActive || followBusy) return;
        try {
          const peek = await window.readToMe.peekWindow(windowId);
          if (!peek?.hash || generation !== followGeneration) return;

          if (!lastContentHash) {
            lastContentHash = peek.hash;
            return;
          }

          if (peek.hash === lastContentHash) {
            pendingHash = null;
            pendingStable = 0;
            return;
          }

          // One confirming poll (~400ms) after the page stops moving.
          if (peek.hash === pendingHash) {
            pendingStable += 1;
          } else {
            pendingHash = peek.hash;
            pendingStable = 1;
            setStatus("Page moving…");
            return;
          }

          if (pendingStable < 2) return;

          lastContentHash = peek.hash;
          pendingHash = null;
          pendingStable = 0;

          setStatus("Page changed — catching up…");
          followBusy = true;
          try {
            // Stop audio immediately so catch-up feels snappy while OCR runs.
            if (speech.speaking || speech.paused) speech.stop();

            const next = await window.readToMe.readWindowById(windowId);
            if (generation !== followGeneration || !followActive) return;

            if (!textsDifferEnough(currentText, next.text)) {
              if (speech.speaking || speech.paused) setStatus("Speaking…");
              else setStatus("Following the page — scroll anytime");
              return;
            }

            currentText = next.text;
            if (next.title) {
              selected = { id: next.id || windowId, name: next.title };
              targetLabel.textContent = next.title;
              targetLabel.title = next.title;
            }

            reading = true;
            try {
              await speakTextStreaming(next.text, {
                statusPrefix: "Speaking new page…",
              });
              if (followActive) setStatus("Following the page — scroll anytime");
              else setStatus("");
            } finally {
              reading = false;
              readBtn.disabled = false;
            }
          } finally {
            followBusy = false;
          }
        } catch (error) {
          // Keep following; one failed peek shouldn't kill the session.
          console.warn("Follow-page check failed:", error?.message || error);
        }
      })();
    }, 400);
  }


  async function resizeForPicker(open) {
    pill.classList.toggle("is-expanded", open);
    await window.readToMe.resizePill({
      width: 440,
      height: open ? 380 : 78,
    });
  }

  async function loadWindows() {
    setStatus("Looking for open windows…");
    const windows = await window.readToMe.listWindows();
    pickerList.innerHTML = "";

    if (!windows.length) {
      pickerList.innerHTML =
        "<p class='picker-hint'>No windows found. Open your PDF in Preview, then refresh.</p>";
      setStatus("");
      return;
    }

    for (const win of windows) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "window-option" + (win.id === selected.id ? " is-selected" : "");
      btn.innerHTML = `<img src="${win.thumbnail}" alt="" /><span></span>`;
      btn.querySelector("span").textContent = win.name;
      btn.addEventListener("click", async () => {
        selected = { id: win.id, name: win.name };
        forceSelected = true;
        await window.readToMe.selectWindow(win.id);
        targetLabel.textContent = win.name;
        targetLabel.title = win.name;
        pickerOpen = false;
        picker.hidden = true;
        await resizeForPicker(false);
        setStatus("Ready — click Read");
      });
      pickerList.appendChild(btn);
    }
    setStatus("");
  }

  pickBtn.addEventListener("click", async () => {
    pickerOpen = !pickerOpen;
    picker.hidden = !pickerOpen;
    await resizeForPicker(pickerOpen);
    if (pickerOpen) await loadWindows();
  });

  refreshBtn.addEventListener("click", () => {
    void loadWindows();
  });

  readBtn.addEventListener("click", async () => {
    reading = true;
    readBtn.disabled = true;
    stopFollow();
    speech.stop();
    if (pickerOpen) {
      pickerOpen = false;
      picker.hidden = true;
      await resizeForPicker(false);
    }

    setStatus("Reading the active window…");
    try {
      const useForced = forceSelected && selected.id;
      forceSelected = false;
      const result = useForced
        ? await window.readToMe.readSelectedWindow()
        : await window.readToMe.readActiveWindow();

      if (result.title) {
        selected = { id: result.id || selected.id, name: result.title };
        targetLabel.textContent = result.title;
        targetLabel.title = result.title;
      }

      const cols =
        result.columns > 1
          ? ` · ${result.columns} columns (left, then right)`
          : "";
      setStatus(`Starting voice${cols}…`);

      // Stream speech: first sentences play while later ones synthesize.
      const speakPromise = speakTextStreaming(result.text);
      // Follow scrolls on this window while speaking.
      startFollow(result.id || selected.id, result.text);
      await speakPromise;
      if (followActive) setStatus("Following the page — scroll anytime");
      else setStatus("");
    } catch (error) {
      stopFollow();
      setStatus(error?.message || "Could not read that window");
      applyPlaybackUi("idle");
    } finally {
      reading = false;
      readBtn.disabled = false;
      applyPlaybackUi(
        speech.speaking ? "speaking" : speech.paused ? "paused" : "idle",
      );
    }
  });

  pauseBtn.addEventListener("click", () => speech.pause());
  resumeBtn.addEventListener("click", () => speech.resume());
  stopBtn.addEventListener("click", () => {
    stopFollow();
    speech.stop();
    reading = false;
    readBtn.disabled = false;
    applyPlaybackUi("idle");
    setStatus("Stopped — click Read anytime");
  });

  targetLabel.textContent = "Active window";
  targetLabel.title = "Click Read to speak the window you were just using";
  setStatus("Open a PDF, then click Read");
  applyPlaybackUi("idle");
})();
