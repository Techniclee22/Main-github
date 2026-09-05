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
  let followCatchupId = 0;
  let lastProfile = null;
  let pendingProfile = null;
  let pendingStable = 0;
  let followActive = false;
  let followFocusKey = "";
  let pendingFocusKey = "";
  let pendingFocusStable = 0;
  /** Prevent overlapping follow ticks (OCR can take longer than the interval). */
  let followTickBusy = false;
  /** True after focus landed on a window with no OCR text (e.g. Terminal). */
  let followWaitingForReadable = false;
  /**
   * Only one speakTextStreaming loop may drive `say`. Retargeting used to
   * arm() a new loop while the PDF loop was still alive — arm cleared Stop,
   * so the PDF kept talking while the pill/highlight showed the new window.
   */
  let speakSession = 0;
  /** Window id follow is currently reading — blocks stale continue-after-page. */
  let followTargetId = null;

  const SCROLL_MOVE_FRACTION = 0.25;
  const SCROLL_STILL_FRACTION = 0.06;
  const FOLLOW_ARM_MS = 2000;
  const FOLLOW_SETTLE_PEEKS = 3;
  const { scrollFraction } = window.ReadToMeFollowPeek;

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
    followCatchupId += 1;
    // Do NOT bump speakSession or hide the highlight here — startFollow()
    // calls stopFollow() ~500ms into Read to arm scroll-follow, and
    // invalidating the session was aborting speech after the first sentence.
    followTickBusy = false;
    if (followTimer) {
      clearInterval(followTimer);
      followTimer = null;
    }
    lastProfile = null;
    pendingProfile = null;
    pendingStable = 0;
    followFocusKey = "";
    pendingFocusKey = "";
    pendingFocusStable = 0;
    followWaitingForReadable = false;
    followTargetId = null;
    applyPlaybackUi(
      speech.speaking ? "speaking" : speech.paused ? "paused" : "idle",
    );
  }

  /** Hard-cancel follow + speech (Stop button / fatal Read errors). */
  function stopAll() {
    speakSession += 1;
    stopFollow();
    speech.stop();
    void window.readToMe.hideReadingHighlight();
  }

  function speechIsCurrent(session) {
    return session === speakSession && !speech.stopped;
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

  function splitSentences(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return [];
    // Avoid lookbehind — keep sentence splits compatible with older Chromium.
    const parts = [];
    let start = 0;
    for (let i = 0; i < clean.length; i += 1) {
      const ch = clean[i];
      if ((ch === "." || ch === "?" || ch === "!") && (i + 1 === clean.length || clean[i + 1] === " ")) {
        const piece = clean.slice(start, i + 1).trim();
        if (piece) parts.push(piece);
        start = i + 1;
      }
    }
    const tail = clean.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length ? parts : [clean];
  }

  async function speakTextStreaming(text, { statusPrefix, windowId } = {}) {
    const clean = String(text || "").trim();
    if (!clean) throw new Error("Nothing to speak.");

    const sourceId = windowId || selected.id;
    const session = ++speakSession;
    // Kill any in-flight PDF (or prior window) utterance before arming.
    speech.stop();
    speech.arm();

    setStatus(statusPrefix || "Speaking with your system voice…");
    const sentences = splitSentences(clean);
    const total = Math.max(1, sentences.length);

    try {
      for (let i = 0; i < sentences.length; i += 1) {
        if (!speechIsCurrent(session)) break;
        const fraction = i / total;
        if (sourceId) {
          try {
            void window.readToMe.highlightReading({ sourceId, fraction });
          } catch {
            // Overlay is best-effort — never block speech if it fails.
          }
        }
        setStatus(
          `${statusPrefix || "Speaking…"} (${i + 1}/${sentences.length})`,
        );
        try {
          await speech.speakLive(sentences[i]);
        } catch (error) {
          if (!speechIsCurrent(session)) break;
          console.warn("Live say failed, falling back:", error?.message || error);
          // Fall back for this sentence only (planSpeech / WAV path).
          const plan = await window.readToMe.planSpeech(sentences[i]);
          if (!plan.chunks?.length) throw error;
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
        if (!speechIsCurrent(session)) break;
      }
    } catch (error) {
      if (session === speakSession) {
        void window.readToMe.hideReadingHighlight();
      }
      throw error;
    } finally {
      // A newer session owns the overlay — don't yank it when the old loop ends.
      if (session === speakSession) {
        void window.readToMe.hideReadingHighlight();
      }
    }
    return session;
  }

  /**
   * After a full capture finishes speaking, scroll the target ~one page and
   * keep reading — cancelled by Stop via followGeneration / followCatchupId.
   */
  async function continueAfterPage(windowId, previousText, generation, depth = 0) {
    if (!followActive || speech.stopped) return;
    if (generation !== followGeneration) return;
    // Focus moved to Terminal (etc.) or retargeted — don't keep paging the PDF.
    if (followWaitingForReadable) return;
    if (followTargetId && windowId !== followTargetId) return;
    if (depth >= 40) {
      setStatus("Following the page — scroll anytime");
      return;
    }

    const myCatchup = ++followCatchupId;
    lastProfile = null;
    pendingProfile = null;
    pendingStable = 0;

    const hint = await window.readToMe.getFocusHint();
    const key = focusKey(hint);
    if (key && followFocusKey && key !== followFocusKey) {
      return;
    }

    setStatus("Scrolling to continue…");
    const scrolled = await window.readToMe.scrollTargetWindow();
    if (
      myCatchup !== followCatchupId ||
      generation !== followGeneration ||
      !followActive ||
      speech.stopped
    ) {
      return;
    }
    if (!scrolled?.ok) {
      setStatus("Following the page — scroll anytime");
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 800));
    if (
      myCatchup !== followCatchupId ||
      generation !== followGeneration ||
      !followActive ||
      speech.stopped
    ) {
      return;
    }

    setStatus("Reading the next section…");
    const next = await window.readToMe.readWindowById(windowId);
    if (
      myCatchup !== followCatchupId ||
      generation !== followGeneration ||
      !followActive ||
      speech.stopped
    ) {
      return;
    }

    if (!textsDifferEnough(previousText, next.text)) {
      setStatus("Following the page — scroll anytime");
      return;
    }

    if (next.title) {
      selected = { id: next.id || windowId, name: next.title };
      targetLabel.textContent = next.title;
      targetLabel.title = next.title;
    }

    reading = true;
    try {
      await speakTextStreaming(next.text, {
        statusPrefix: "Speaking…",
        windowId: next.id || windowId,
      });
    } finally {
      reading = false;
    }

    if (
      myCatchup === followCatchupId &&
      followActive &&
      !speech.stopped &&
      generation === followGeneration
    ) {
      await continueAfterPage(
        next.id || windowId,
        next.text,
        generation,
        depth + 1,
      );
    }
  }

  function focusKey(hint) {
    if (!hint?.app) return "";
    return `${String(hint.app).toLowerCase()}|${String(hint.title || "").toLowerCase()}`;
  }

  function startFollow(windowId, seedText) {
    stopFollow();
    if (!windowId) return;

    followActive = true;
    followTickBusy = false;
    followWaitingForReadable = false;
    followTargetId = windowId;
    applyPlaybackUi(
      speech.speaking ? "speaking" : speech.paused ? "paused" : "idle",
    );
    const generation = followGeneration;
    let followedId = windowId;
    let currentText = seedText || "";
    lastProfile = null;
    pendingProfile = null;
    pendingStable = 0;
    pendingFocusKey = "";
    pendingFocusStable = 0;
    const armedAt = Date.now() + FOLLOW_ARM_MS;

    followTimer = setInterval(() => {
      void (async () => {
        if (generation !== followGeneration || !followActive) return;
        if (followTickBusy) return;
        followTickBusy = true;
        try {
          const hint = await window.readToMe.getFocusHint();
          if (generation !== followGeneration || !followActive) return;
          const key = focusKey(hint);
          if (!followFocusKey && key) followFocusKey = key;

          // Parked on Terminal (etc.): don't peek/re-read the old PDF — that
          // restarts speech and sends the highlight bar flying.
          if (followWaitingForReadable && key && key === followFocusKey) {
            return;
          }

          if (
            Date.now() >= armedAt &&
            key &&
            followFocusKey &&
            key !== followFocusKey
          ) {
            if (key !== pendingFocusKey) {
              pendingFocusKey = key;
              pendingFocusStable = 1;
              return;
            }
            pendingFocusStable += 1;
            if (pendingFocusStable < 2) return;

            pendingFocusKey = "";
            pendingFocusStable = 0;
            // OCR first while the old page can keep speaking. Only stop/switch
            // when the new window has readable text — otherwise adopt the focus
            // key once so Terminal doesn't spam OCR every 250ms.
            setStatus(`Checking ${hint.app || "window"}…`);
            const next = await window.readToMe.readActiveWindow();
            if (generation !== followGeneration || !followActive) return;

            if (!next?.text?.trim() || next.empty) {
              followFocusKey = key;
              followWaitingForReadable = true;
              followCatchupId += 1;
              speakSession += 1;
              if (speech.speaking || speech.paused) speech.stop();
              void window.readToMe.hideReadingHighlight();
              setStatus(
                `Can't read ${hint.app || "that window"} — switch back to continue`,
              );
              return;
            }

            followCatchupId += 1;
            if (speech.speaking || speech.paused) speech.stop();
            followFocusKey = key;
            followWaitingForReadable = false;
            followedId = next.id || followedId;
            followTargetId = followedId;
            currentText = next.text;
            if (next.title) {
              selected = { id: followedId, name: next.title };
              targetLabel.textContent = next.title;
              targetLabel.title = next.title;
            }
            lastProfile = null;
            pendingProfile = null;
            pendingStable = 0;
            reading = true;
            try {
              await speakTextStreaming(next.text, {
                statusPrefix: "Speaking…",
                windowId: followedId,
              });
            } finally {
              reading = false;
              readBtn.disabled = false;
            }
            return;
          }

          const peek = await window.readToMe.peekWindow(followedId);
          if (!peek?.profile?.length || generation !== followGeneration) return;

          if (Date.now() < armedAt) {
            lastProfile = peek.profile;
            pendingProfile = null;
            pendingStable = 0;
            return;
          }

          if (!lastProfile) {
            lastProfile = peek.profile;
            return;
          }

          const fromBaseline = scrollFraction(lastProfile, peek.profile);

          if (fromBaseline < SCROLL_MOVE_FRACTION) {
            pendingProfile = null;
            pendingStable = 0;
            return;
          }

          if (
            !pendingProfile ||
            scrollFraction(pendingProfile, peek.profile) >= SCROLL_STILL_FRACTION
          ) {
            pendingProfile = peek.profile;
            pendingStable = 1;
            setStatus("Page moving…");
            followCatchupId += 1;
            if (speech.speaking || speech.paused) speech.stop();
            return;
          }

          pendingStable += 1;
          if (pendingStable < FOLLOW_SETTLE_PEEKS) {
            setStatus("Page moving…");
            return;
          }

          lastProfile = peek.profile;
          pendingProfile = null;
          pendingStable = 0;

          const myCatchup = ++followCatchupId;
          setStatus("Page settled — reading…");
          const next = await window.readToMe.readWindowById(followedId);
          if (
            myCatchup !== followCatchupId ||
            generation !== followGeneration ||
            !followActive
          ) {
            return;
          }

          if (!textsDifferEnough(currentText, next.text)) {
            if (speech.speaking || speech.paused) setStatus("Speaking…");
            else setStatus("Following the page — scroll anytime");
            return;
          }

          currentText = next.text;
          if (next.title) {
            selected = { id: next.id || followedId, name: next.title };
            targetLabel.textContent = next.title;
            targetLabel.title = next.title;
          }

          reading = true;
          try {
            await speakTextStreaming(next.text, {
              statusPrefix: "Speaking new page…",
              windowId: next.id || followedId,
            });
            if (myCatchup !== followCatchupId || !followActive) return;
            if (!speech.stopped) {
              await continueAfterPage(
                next.id || followedId,
                next.text,
                generation,
              );
            } else {
              setStatus("Following the page — scroll anytime");
            }
          } finally {
            reading = false;
            readBtn.disabled = false;
          }
        } catch (error) {
          // Keep following; one failed peek shouldn't kill the session.
          console.warn("Follow-page check failed:", error?.message || error);
        } finally {
          followTickBusy = false;
        }
      })();
    }, 250);
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
    stopAll();
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

      if (!result?.text?.trim() || result.empty) {
        throw new Error(
          "No readable text found. Zoom the PDF a bit, then try Read again.",
        );
      }

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

      const windowId = result.id || selected.id;
      // Start voice first; arm follow after a beat so the baseline hash
      // isn't taken while Preview is still settling from the Read click.
      const speakPromise = speakTextStreaming(result.text, { windowId });
      window.setTimeout(() => {
        if (!speech.stopped) startFollow(windowId, result.text);
      }, 500);
      const session = await speakPromise;
      // If focus already retargeted (Terminal), a newer speakSession owns
      // speech — do not page-down/re-read the original PDF on top of it.
      if (followActive && speechIsCurrent(session)) {
        await continueAfterPage(windowId, result.text, followGeneration);
      } else if (!followActive) {
        setStatus("");
      }
    } catch (error) {
      stopAll();
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
    stopAll();
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
