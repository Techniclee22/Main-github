(() => {
  const titleEl = document.getElementById("title");
  const metaEl = document.getElementById("meta");
  const bodyEl = document.getElementById("body");
  const pauseBtn = document.getElementById("pauseBtn");
  const resumeBtn = document.getElementById("resumeBtn");
  const stopBtn = document.getElementById("stopBtn");

  /** @type {{start:number,end:number,el:HTMLElement}[]} */
  let wordSpans = [];
  let activeIndex = -1;
  let pendingScroll = false;

  function buildWordSpans(text) {
    bodyEl.textContent = "";
    wordSpans = [];
    activeIndex = -1;

    const re = /\S+|\s+/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      const token = match[0];
      if (/^\s+$/.test(token)) {
        bodyEl.append(document.createTextNode(token));
        continue;
      }
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = token;
      bodyEl.append(span);
      wordSpans.push({
        start: match.index,
        end: match.index + token.length,
        el: span,
      });
    }
  }

  function scrollIfNeeded(el) {
    if (pendingScroll) return;
    const rect = el.getBoundingClientRect();
    const margin = 120;
    const outOfView = rect.top < margin || rect.bottom > window.innerHeight - 80;
    if (!outOfView) return;
    pendingScroll = true;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      pendingScroll = false;
    });
  }

  function highlightAtChar(charIndex, wordIndex) {
    if (charIndex == null && wordIndex == null) {
      for (const w of wordSpans) {
        w.el.classList.remove("is-active", "is-read");
      }
      activeIndex = -1;
      return;
    }

    let next = -1;
    if (typeof wordIndex === "number" && wordIndex >= 0 && wordIndex < wordSpans.length) {
      next = wordIndex;
    } else if (charIndex != null) {
      next = wordSpans.findIndex((w) => charIndex >= w.start && charIndex < w.end);
      if (next < 0) next = wordSpans.findIndex((w) => w.start >= charIndex);
    }
    if (next < 0 || next === activeIndex) return;

    if (activeIndex >= 0 && wordSpans[activeIndex]) {
      wordSpans[activeIndex].el.classList.remove("is-active");
      wordSpans[activeIndex].el.classList.add("is-read");
    }
    // Mark skipped words as read when audio jumps ahead.
    const from = Math.max(0, activeIndex + 1);
    for (let i = from; i < next; i += 1) {
      wordSpans[i].el.classList.add("is-read");
      wordSpans[i].el.classList.remove("is-active");
    }

    activeIndex = next;
    const el = wordSpans[activeIndex].el;
    el.classList.add("is-active");
    el.classList.remove("is-read");
    scrollIfNeeded(el);
  }

  function applyState(state) {
    if (state && typeof state === "object") {
      if (state.type === "boundary") {
        highlightAtChar(state.charIndex, state.wordIndex);
      }
      return;
    }
    const speaking = state === "speaking";
    const paused = state === "paused";
    pauseBtn.hidden = !speaking;
    resumeBtn.hidden = !paused;
    stopBtn.hidden = !(speaking || paused);
    if (state === "idle") {
      if (activeIndex >= 0 && wordSpans[activeIndex]) {
        wordSpans[activeIndex].el.classList.remove("is-active");
        wordSpans[activeIndex].el.classList.add("is-read");
      }
    }
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
    const text = payload.text || "";
    titleEl.textContent = payload.title || "Reading";
    metaEl.textContent =
      payload.columns > 1
        ? `Detected ${payload.columns} columns · reading left column, then right`
        : "Follow the highlighted word as it is spoken";
    buildWordSpans(text);
  });

  window.readToMe.onPlaybackState((state) => {
    applyState(state);
  });

  applyState("idle");
})();
