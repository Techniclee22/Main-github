(() => {
  const pickBtn = document.getElementById("pickBtn");
  const readBtn = document.getElementById("readBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const stopBtn = document.getElementById("stopBtn");
  const followBtn = document.getElementById("followBtn");
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
      window.readToMe.sendPlaybackState(state);
    },
    onBoundary(boundary) {
      window.readToMe.sendPlaybackState({
        type: "boundary",
        charIndex: boundary.charIndex,
      });
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
      width: 420,
      height: open ? 360 : 72,
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
    setStatus("Reading the window…");
    try {
      const result = await window.readToMe.readSelectedWindow();
      setStatus("Speaking…");
      await window.readToMe.openReader();
      await speech.speak(result.text);
      setStatus("");
    } catch (error) {
      setStatus(error?.message || "Could not read that window");
      applyPlaybackUi("idle");
    } finally {
      readBtn.disabled = false;
    }
  });

  pauseBtn.addEventListener("click", () => {
    speech.pause();
    window.readToMe.sendPlaybackCommand("pause");
  });

  resumeBtn.addEventListener("click", () => {
    speech.resume();
    window.readToMe.sendPlaybackCommand("resume");
  });

  stopBtn.addEventListener("click", () => {
    speech.stop();
    window.readToMe.sendPlaybackCommand("stop");
    setStatus("");
  });

  followBtn.addEventListener("click", () => {
    void window.readToMe.openReader();
  });

  window.readToMe.onPlaybackCommand((command) => {
    if (command === "pause") speech.pause();
    if (command === "resume") speech.resume();
    if (command === "stop") speech.stop();
  });

  applyPlaybackUi("idle");
})();
