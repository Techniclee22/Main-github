(() => {
  function preferNaturalVoice(voices) {
    const english = voices.filter((v) =>
      (v.lang || "").toLowerCase().startsWith("en"),
    );
    const pool = english.length ? english : voices;
    const ranked = [...pool].sort((a, b) => {
      const score = (voice) => {
        const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
        let value = 0;
        if (/premium|enhanced|neural|natural|super/.test(name)) value += 12;
        if (/samantha|zoe|ava|allison|susan|nicky|tom|moira|daniel|karen|alex|victoria/.test(name)) {
          value += 6;
        }
        if (/google|microsoft|siri/.test(name)) value += 3;
        if (voice.localService) value += 2;
        if ((voice.lang || "").toLowerCase().startsWith("en-us")) value += 5;
        else if ((voice.lang || "").toLowerCase().startsWith("en")) value += 4;
        if (/compact|robot|novelty|whisper|zarvox|trinoids|bad news|boing|bubbles|cellos/.test(name)) {
          value -= 20;
        }
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

  function tokenizeWords(text) {
    const words = [];
    const re = /\S+/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      words.push({
        start: match.index,
        end: match.index + match[0].length,
        length: match[0].length,
      });
    }
    return words;
  }

  function base64ToBlob(base64, mime) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: mime || "audio/mpeg" });
  }

  window.ReadToMeSpeech = {
    create({ onState, onBoundary, onVoiceInfo } = {}) {
      let speaking = false;
      let paused = false;
      /** @type {HTMLAudioElement | null} */
      let audioEl = null;
      /** @type {string[]} */
      let objectUrls = [];
      /** @type {SpeechSynthesisUtterance | null} */
      let utterance = null;
      /** @type {ReturnType<typeof setInterval> | null} */
      let tickTimer = null;
      let words = [];
      let wordIndex = -1;
      let stopped = false;
      let liveMode = false;
      /** @type {(() => void) | null} */
      let abortCurrentPart = null;

      function clearTick() {
        if (tickTimer) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
      }

      function revokeUrls() {
        for (const url of objectUrls) URL.revokeObjectURL(url);
        objectUrls = [];
      }

      function stopAudio() {
        if (!audioEl) return;
        audioEl.ontimeupdate = null;
        audioEl.onended = null;
        audioEl.onerror = null;
        audioEl.onplay = null;
        audioEl.onpause = null;
        audioEl.pause();
        audioEl.removeAttribute("src");
        audioEl.load();
        audioEl = null;
      }

      function emitBoundary(index) {
        if (index < 0 || index >= words.length) return;
        if (index === wordIndex) return;
        wordIndex = index;
        const word = words[index];
        onBoundary?.({
          charIndex: word.start,
          charLength: word.length,
          wordIndex: index,
        });
      }

      function emitProgress(progress) {
        if (!words.length) return;
        const clamped = Math.max(0, Math.min(0.999, progress));
        const index = Math.min(
          words.length - 1,
          Math.floor(clamped * words.length),
        );
        emitBoundary(index);
      }

      function startEstimatedTick(totalMs) {
        clearTick();
        if (!words.length || totalMs <= 0) return;
        const started = performance.now();
        const startWord = Math.max(0, wordIndex);
        tickTimer = setInterval(() => {
          if (paused || stopped) return;
          const elapsed = performance.now() - started;
          const progress =
            startWord / words.length +
            (elapsed / totalMs) * ((words.length - startWord) / words.length);
          emitProgress(progress);
        }, 80);
      }

      function cleanupPlayback() {
        clearTick();
        if (abortCurrentPart) {
          const abort = abortCurrentPart;
          abortCurrentPart = null;
          abort();
        }
        stopAudio();
        revokeUrls();
        utterance = null;
        speechSynthesis.cancel();
      }

      function finishIdle() {
        speaking = false;
        paused = false;
        clearTick();
        onState?.("idle");
      }

      async function playAudioParts(prepared) {
        const parts = prepared.parts || [];
        const mime = prepared.mime || "audio/mpeg";
        if (!parts.length) return false;

        onVoiceInfo?.({
          engine: prepared.engine,
          voice: prepared.voice || prepared.engine,
        });

        for (let i = 0; i < parts.length; i += 1) {
          if (stopped) return true;
          const blob = base64ToBlob(parts[i], mime);
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);

          await new Promise((resolve, reject) => {
            stopAudio();
            audioEl = new Audio(url);
            abortCurrentPart = () => resolve();
            audioEl.onplay = () => {
              if (!speaking) {
                speaking = true;
                paused = false;
                onState?.("speaking");
              }
            };
            audioEl.ontimeupdate = () => {
              if (!audioEl || !audioEl.duration || !Number.isFinite(audioEl.duration)) {
                return;
              }
              const partWeight = 1 / parts.length;
              const local = audioEl.currentTime / audioEl.duration;
              const overall = i * partWeight + local * partWeight;
              emitProgress(overall);
            };
            audioEl.onended = () => {
              abortCurrentPart = null;
              resolve();
            };
            audioEl.onerror = () => {
              abortCurrentPart = null;
              reject(new Error("Could not play the natural voice audio."));
            };
            audioEl.onpause = () => {
              if (paused) onState?.("paused");
            };
            void audioEl.play().catch((error) => {
              abortCurrentPart = null;
              reject(error);
            });
          });
        }

        return true;
      }

      async function speakWithBrowser(text) {
        speechSynthesis.cancel();
        const voices = await waitForVoices();
        const voice = preferNaturalVoice(voices);
        utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        if (voice) utterance.voice = voice;
        utterance.rate = 0.96;
        utterance.pitch = 1;
        onVoiceInfo?.({
          engine: "browser",
          voice: voice?.name || "System voice",
        });

        const estimatedMs = Math.max(2500, (words.length / 165) * 60 * 1000);

        await new Promise((resolve) => {
          abortCurrentPart = () => resolve();
          utterance.onstart = () => {
            speaking = true;
            paused = false;
            onState?.("speaking");
            startEstimatedTick(estimatedMs);
          };
          utterance.onend = () => {
            abortCurrentPart = null;
            clearTick();
            if (words.length) emitBoundary(words.length - 1);
            resolve();
          };
          utterance.onerror = () => {
            abortCurrentPart = null;
            clearTick();
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
            if (event.name !== "word" && event.charIndex == null) return;
            const index = words.findIndex(
              (w) => event.charIndex >= w.start && event.charIndex < w.end,
            );
            if (index >= 0) {
              clearTick();
              emitBoundary(index);
              const remaining = words.length - index;
              startEstimatedTick(Math.max(1200, (remaining / 165) * 60 * 1000));
            } else {
              onBoundary?.({
                charIndex: event.charIndex,
                charLength: event.charLength || 0,
              });
            }
          };
          speechSynthesis.speak(utterance);
        });
      }

      return {
        async speak(text, prepared) {
          stopped = false;
          cleanupPlayback();
          words = tokenizeWords(text);
          wordIndex = -1;
          speaking = false;
          paused = false;

          try {
            if (prepared?.parts?.length) {
              await playAudioParts(prepared);
            } else {
              await speakWithBrowser(text);
            }
          } finally {
            cleanupPlayback();
            finishIdle();
          }
        },
        /**
         * Play audio chunk-by-chunk. First chunk can start while later ones
         * are still being synthesized (prefetch via getChunk).
         * @param {{
         *   chunkCount: number,
         *   getChunk: (index: number) => Promise<{parts?: string[], mime?: string, engine?: string, voice?: string, text?: string}>,
         * }} options
         */
        async speakStream({ chunkCount, getChunk }) {
          stopped = false;
          cleanupPlayback();
          words = [];
          wordIndex = -1;
          speaking = true;
          paused = false;
          onState?.("speaking");

          try {
            for (let i = 0; i < chunkCount; i += 1) {
              if (stopped) break;
              const prepared = await getChunk(i);
              if (stopped) break;
              if (prepared?.text) {
                words = tokenizeWords(prepared.text);
                wordIndex = -1;
              }
              if (prepared?.parts?.length) {
                await playAudioParts(prepared);
              } else if (prepared?.text) {
                await speakWithBrowser(prepared.text);
              }
            }
          } finally {
            cleanupPlayback();
            finishIdle();
          }
        },
        /**
         * Clear the Stop latch once before a multi-sentence read.
         * speakLive must not clear it — otherwise Stop only lasts until the
         * next sentence in the loop.
         */
        arm() {
          stopped = false;
        },
        /**
         * Speak immediately through main's live engine (no WAV render wait).
         */
        async speakLive(text) {
          if (stopped) return;
          liveMode = true;
          cleanupPlayback();
          words = tokenizeWords(text || "");
          wordIndex = -1;
          speaking = true;
          paused = false;
          onState?.("speaking");

          try {
            if (stopped) return;
            const result = await window.readToMe.speakLive(text);
            if (result?.voice && typeof result.engine === "string" && result.engine) {
              onVoiceInfo?.({ engine: result.engine, voice: result.voice });
            }
          } finally {
            liveMode = false;
            if (!stopped) {
              speaking = false;
              paused = false;
              onState?.("idle");
            }
          }
        },
        /**
         * Warm the next sentence while the current one plays so Kokoro does
         * not leave a synth-sized gap between sentences.
         */
        prefetchLive(text) {
          if (stopped) return;
          void window.readToMe.prefetchLive(text);
        },
        async pause() {
          if (liveMode) {
            const res = await window.readToMe.pauseLiveSay();
            if (res?.ok !== false) {
              paused = true;
              onState?.("paused");
            }
            return;
          }
          if (audioEl && !audioEl.paused) {
            paused = true;
            audioEl.pause();
            onState?.("paused");
            return;
          }
          if (speechSynthesis.speaking && !speechSynthesis.paused) {
            paused = true;
            speechSynthesis.pause();
          }
        },
        async resume() {
          if (liveMode) {
            const res = await window.readToMe.resumeLiveSay();
            if (res?.ok !== false) {
              paused = false;
              onState?.("speaking");
            }
            return;
          }
          if (audioEl && audioEl.paused) {
            paused = false;
            void audioEl.play();
            onState?.("speaking");
            return;
          }
          if (speechSynthesis.paused) {
            paused = false;
            speechSynthesis.resume();
          }
        },
        stop() {
          stopped = true;
          if (liveMode) {
            void window.readToMe.stopLiveSay();
            liveMode = false;
          }
          cleanupPlayback();
          speaking = false;
          paused = false;
          wordIndex = -1;
          onState?.("idle");
        },
        get speaking() {
          return speaking && !paused;
        },
        get paused() {
          return paused;
        },
        get stopped() {
          return stopped;
        },
      };
    },
  };
})();
