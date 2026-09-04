(() => {
  function preferNaturalVoice(voices) {
    const ranked = [...voices].sort((a, b) => {
      const score = (voice) => {
        const name = voice.name.toLowerCase();
        let value = 0;
        if (name.includes("premium") || name.includes("enhanced")) value += 5;
        if (name.includes("natural") || name.includes("neural")) value += 5;
        if (name.includes("siri") || name.includes("ava") || name.includes("zoe"))
          value += 3;
        if (name.includes("google") || name.includes("microsoft")) value += 2;
        if (voice.localService) value += 1;
        if (voice.lang.toLowerCase().startsWith("en")) value += 2;
        return value;
      };
      return score(b) - score(a);
    });
    return ranked[0] || null;
  }

  function waitForVoices() {
    const existing = speechSynthesis.getVoices();
    if (existing.length) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const done = () => {
        speechSynthesis.removeEventListener("voiceschanged", done);
        resolve(speechSynthesis.getVoices());
      };
      speechSynthesis.addEventListener("voiceschanged", done);
      setTimeout(done, 700);
    });
  }

  window.ReadToMeSpeech = {
    create({ onState, onBoundary } = {}) {
      let speaking = false;
      let paused = false;

      return {
        async speak(text) {
          speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          const voices = await waitForVoices();
          const voice = preferNaturalVoice(voices);
          if (voice) utterance.voice = voice;
          utterance.rate = 1;

          await new Promise((resolve) => {
            utterance.onstart = () => {
              speaking = true;
              paused = false;
              onState?.("speaking");
            };
            utterance.onend = () => {
              speaking = false;
              paused = false;
              onState?.("idle");
              resolve();
            };
            utterance.onerror = () => {
              speaking = false;
              paused = false;
              onState?.("idle");
              resolve();
            };
            utterance.onpause = () => {
              paused = true;
              onState?.("paused");
            };
            utterance.onresume = () => {
              paused = false;
              onState?.("speaking");
            };
            utterance.onboundary = (event) => {
              if (event.name === "word") {
                onBoundary?.({
                  charIndex: event.charIndex,
                  charLength: event.charLength || 0,
                });
              }
            };
            speechSynthesis.speak(utterance);
          });
        },
        pause() {
          if (speechSynthesis.speaking) speechSynthesis.pause();
        },
        resume() {
          if (speechSynthesis.paused) speechSynthesis.resume();
        },
        stop() {
          speechSynthesis.cancel();
          speaking = false;
          paused = false;
          onState?.("idle");
        },
        get speaking() {
          return speaking && !paused;
        },
        get paused() {
          return paused;
        },
      };
    },
  };
})();
