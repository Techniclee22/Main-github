(() => {
  const titleEl = document.getElementById("title");
  const bodyEl = document.getElementById("body");
  const pauseBtn = document.getElementById("pauseBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const stopBtn = document.getElementById("stopBtn");

  let text = "";

  function render(highlightIndex) {
    if (!text) return;
    if (highlightIndex == null || highlightIndex < 0) {
      bodyEl.textContent = text;
      return;
    }

    let end = text.indexOf(" ", highlightIndex + 1);
    if (end === -1) end = text.length;
    while (end < text.length && /[.,!?;:]/.test(text[end] || "")) end += 1;

    bodyEl.innerHTML = "";
    bodyEl.append(document.createTextNode(text.slice(0, highlightIndex)));
    const mark = document.createElement("mark");
    mark.className = "mark";
    mark.textContent = text.slice(highlightIndex, end);
    bodyEl.append(mark);
    bodyEl.append(document.createTextNode(text.slice(end)));
    mark.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function applyState(state) {
    if (state && typeof state === "object") {
      if (state.type === "boundary") render(state.charIndex);
      return;
    }
    const speaking = state === "speaking";
    const paused = state === "paused";
    pauseBtn.hidden = !speaking;
    resumeBtn.hidden = !paused;
    stopBtn.hidden = !(speaking || paused);
  }

  pauseBtn.addEventListener("click", () => {
    window.readToMe.sendPlaybackCommand("pause");
  });
  resumeBtn.addEventListener("click", () => {
    window.readToMe.sendPlaybackCommand("resume");
  });
  stopBtn.addEventListener("click", () => {
    window.readToMe.sendPlaybackCommand("stop");
  });

  window.readToMe.onReadingText((payload) => {
    text = payload.text || "";
    titleEl.textContent = payload.title || "Reading";
    render(null);
  });

  window.readToMe.onPlaybackState((state) => {
    applyState(state);
  });

  applyState("idle");
})();
