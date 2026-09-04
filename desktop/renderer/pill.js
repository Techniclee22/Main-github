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
    pauseBtn.hidden = !speaking;
    resumeBtn.hidden = !paused;
    stopBtn.hidden = !(speaking || paused);
    readBtn.hidden = speaking || paused;
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
    if (!selected.id) {
      pickerOpen = true;
      picker.hidden = false;
      await resizeForPicker(true);
      await loadWindows();
      setStatus("Pick the PDF window first");
      return;
    }

    readBtn.disabled = true;
    speech.stop();
    setStatus("Reading the page…");
    try {
      const result = await window.readToMe.readSelectedWindow();
      const cols =
        result.columns > 1
          ? ` · ${result.columns} columns (left, then right)`
          : "";
      setStatus(`Preparing English voice${cols}…`);
      const audio = await window.readToMe.synthesizeSpeech(result.text);
      if (audio?.engine === "neural") {
        setStatus("Speaking (natural English)…");
      } else if (audio?.engine === "macos-say") {
        setStatus(`Speaking with ${audio.voice}…`);
      } else {
        setStatus("Speaking…");
      }
      // Prefer the exact prose that was synthesized (already reflowed).
      await speech.speak(audio?.text || result.text, audio);
      setStatus("");
    } catch (error) {
      setStatus(error?.message || "Could not read that window");
      applyPlaybackUi("idle");
    } finally {
      readBtn.disabled = false;
    }
  });

  pauseBtn.addEventListener("click", () => speech.pause());
  resumeBtn.addEventListener("click", () => speech.resume());
  stopBtn.addEventListener("click", () => {
    speech.stop();
    setStatus("");
  });

  applyPlaybackUi("idle");
})();
