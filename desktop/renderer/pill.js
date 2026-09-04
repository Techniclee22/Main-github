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

  const speech = window.ReadToMeSpeech.create({
    onState(state) {
      applyPlaybackUi(state);
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
    const busy = speaking || paused;
    pauseBtn.hidden = !speaking;
    resumeBtn.hidden = !paused;
    stopBtn.hidden = !busy;
    readBtn.hidden = busy;
    // Stop used to leave Read disabled forever — always clear that here.
    if (!busy && !reading) {
      readBtn.disabled = false;
    }
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
    speech.stop();
    if (pickerOpen) {
      pickerOpen = false;
      picker.hidden = true;
      await resizeForPicker(false);
    }

    setStatus("Reading the active window…");
    try {
      // Default: whatever you were just looking at (PDF in Preview, etc.).
      // Picker override applies for one Read, then we're back to active-window mode.
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
      setStatus(`Preparing English voice${cols}…`);
      const audio = await window.readToMe.synthesizeSpeech(result.text);
      if (audio?.engine === "neural") {
        setStatus("Speaking (natural English)…");
      } else if (audio?.engine === "macos-say") {
        setStatus(`Speaking with your system voice (${audio.voice})…`);
      } else {
        setStatus("Speaking…");
      }
      await speech.speak(audio?.text || result.text, audio);
      setStatus("");
    } catch (error) {
      setStatus(error?.message || "Could not read that window");
      applyPlaybackUi("idle");
    } finally {
      reading = false;
      readBtn.disabled = false;
      applyPlaybackUi(speech.speaking ? "speaking" : speech.paused ? "paused" : "idle");
    }
  });

  pauseBtn.addEventListener("click", () => speech.pause());
  resumeBtn.addEventListener("click", () => speech.resume());
  stopBtn.addEventListener("click", () => {
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
