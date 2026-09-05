import type {
  SpeechEngine,
  SpeechEngineEvents,
  SpeechVoice,
  SpeakOptions,
} from "./types";

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve([]);
  }

  const existing = window.speechSynthesis.getVoices();
  if (existing.length) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    window.setTimeout(done, 750);
  });
}

export function createBrowserSpeechEngine(): SpeechEngine {
  return {
    id: "browser",
    label: "Device voices",
    description:
      "Uses voices built into your phone or computer. Works offline. Quality varies by device.",
    isAvailable: () =>
      typeof window !== "undefined" && "speechSynthesis" in window,

    async listVoices(): Promise<SpeechVoice[]> {
      const voices = await waitForVoices();
      return voices
        .map((voice) => ({
          id: `${voice.name}::${voice.lang}`,
          name: voice.name,
          lang: voice.lang,
          localService: voice.localService,
          engine: "browser" as const,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async speak(
      text,
      options: SpeakOptions = {},
      events: SpeechEngineEvents = {},
    ) {
      if (!this.isAvailable()) {
        events.onError?.("Speech is not available in this browser.");
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);

      const voices = await waitForVoices();
      if (options.voiceId) {
        const match = voices.find(
          (voice) => `${voice.name}::${voice.lang}` === options.voiceId,
        );
        if (match) utterance.voice = match;
      }

      utterance.rate = options.rate ?? 1;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;

      await new Promise<void>((resolve) => {
        utterance.onstart = () => events.onStart?.();
        utterance.onend = () => {
          events.onEnd?.();
          resolve();
        };
        utterance.onerror = (event) => {
          if (event.error !== "canceled" && event.error !== "interrupted") {
            events.onError?.(event.error || "Playback failed.");
          }
          events.onEnd?.();
          resolve();
        };
        utterance.onpause = () => events.onPause?.();
        utterance.onresume = () => events.onResume?.();
        utterance.onboundary = (event) => {
          if (event.name === "word" || event.name === "sentence") {
            events.onBoundary?.({
              charIndex: event.charIndex,
              charLength: event.charLength || 0,
              name: event.name,
            });
          }
        };

        window.speechSynthesis.speak(utterance);
      });
    },

    pause() {
      if (window.speechSynthesis?.speaking) window.speechSynthesis.pause();
    },

    resume() {
      if (window.speechSynthesis?.paused) window.speechSynthesis.resume();
    },

    cancel() {
      window.speechSynthesis?.cancel();
    },

    getSpeaking() {
      return Boolean(window.speechSynthesis?.speaking);
    },

    getPaused() {
      return Boolean(window.speechSynthesis?.paused);
    },
  };
}
