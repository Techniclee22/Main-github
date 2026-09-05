import type {
  SpeechEngine,
  SpeechEngineEvents,
  SpeechVoice,
  SpeakOptions,
} from "./types";

/**
 * Neural TTS via Vercel AI Gateway.
 * Available when AI_GATEWAY_API_KEY (or OIDC on Vercel) is configured.
 */
export function createNeuralSpeechEngine(): SpeechEngine {
  let audio: HTMLAudioElement | null = null;
  let speaking = false;
  let paused = false;

  const voices: SpeechVoice[] = [
    { id: "alloy", name: "Alloy", lang: "en-US", engine: "neural" },
    { id: "echo", name: "Echo", lang: "en-US", engine: "neural" },
    { id: "fable", name: "Fable", lang: "en-GB", engine: "neural" },
    { id: "onyx", name: "Onyx", lang: "en-US", engine: "neural" },
    { id: "nova", name: "Nova", lang: "en-US", engine: "neural" },
    { id: "shimmer", name: "Shimmer", lang: "en-US", engine: "neural" },
  ];

  return {
    id: "neural",
    label: "Natural voices",
    description:
      "Cloud neural voices with more natural tone. Needs internet and voice credits.",
    isAvailable: async () => {
      try {
        const res = await fetch("/api/speech", { method: "HEAD" });
        return res.ok;
      } catch {
        return false;
      }
    },

    async listVoices() {
      return voices;
    },

    async speak(
      text,
      options: SpeakOptions = {},
      events: SpeechEngineEvents = {},
    ) {
      this.cancel();
      events.onStart?.();
      speaking = true;
      paused = false;

      try {
        const res = await fetch("/api/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: options.voiceId ?? "nova",
            speed: options.rate ?? 1,
          }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error || "Natural voice request failed.");
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audio = new Audio(url);
        audio.playbackRate = options.rate ?? 1;

        await new Promise<void>((resolve) => {
          if (!audio) {
            resolve();
            return;
          }

          audio.onended = () => {
            speaking = false;
            paused = false;
            URL.revokeObjectURL(url);
            events.onEnd?.();
            resolve();
          };
          audio.onerror = () => {
            speaking = false;
            paused = false;
            URL.revokeObjectURL(url);
            events.onError?.("Could not play natural voice audio.");
            events.onEnd?.();
            resolve();
          };

          void audio.play().catch((error: unknown) => {
            speaking = false;
            paused = false;
            URL.revokeObjectURL(url);
            events.onError?.(
              error instanceof Error
                ? error.message
                : "Could not play natural voice audio.",
            );
            events.onEnd?.();
            resolve();
          });
        });
      } catch (error) {
        speaking = false;
        paused = false;
        events.onError?.(
          error instanceof Error ? error.message : "Natural voice failed.",
        );
        events.onEnd?.();
      }
    },

    pause() {
      if (audio && !audio.paused) {
        audio.pause();
        paused = true;
      }
    },

    resume() {
      if (audio && audio.paused) {
        void audio.play();
        paused = false;
      }
    },

    cancel() {
      if (audio) {
        audio.pause();
        audio.src = "";
        audio = null;
      }
      speaking = false;
      paused = false;
    },

    getSpeaking() {
      return speaking && !paused;
    },

    getPaused() {
      return paused;
    },
  };
}
