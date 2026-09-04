"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ENGINE_OPTIONS,
  getSpeechEngine,
  type SpeechVoice,
  type VoiceEngineId,
} from "@/lib/voice";
import { chunkText } from "@/lib/text";

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "speaking"
  | "paused"
  | "error";

function pickDefaultVoice(
  list: SpeechVoice[],
  current?: string,
): string | undefined {
  if (current && list.some((voice) => voice.id === current)) return current;
  return (
    list.find((voice) => voice.lang.toLowerCase().startsWith("en"))?.id ??
    list[0]?.id
  );
}

export function useSpeech() {
  const [engineId, setEngineId] = useState<VoiceEngineId>("browser");
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string | undefined>();
  const [rate, setRate] = useState(1);
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [neuralAvailable, setNeuralAvailable] = useState(false);

  const engineRef = useRef(getSpeechEngine("browser"));
  const queueRef = useRef<string[]>([]);
  const voiceIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    voiceIdRef.current = voiceId;
  }, [voiceId]);

  useEffect(() => {
    let cancelled = false;
    const engine = getSpeechEngine("browser");
    engineRef.current = engine;

    engine.listVoices().then((list) => {
      if (cancelled) return;
      setVoices(list);
      setVoiceId((current) => pickDefaultVoice(list, current));
    });

    fetch("/api/speech", { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setNeuralAvailable(res.ok);
      })
      .catch(() => {
        if (!cancelled) setNeuralAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const speak = useCallback(
    async (text: string) => {
      const cleaned = text.trim();
      if (!cleaned) {
        setError("Nothing to read yet. Capture or paste some text first.");
        setStatus("error");
        return;
      }

      setError(null);
      engineRef.current.cancel();
      queueRef.current = chunkText(
        cleaned,
        engineId === "neural" ? 3500 : 12000,
      );
      setHighlightIndex(0);

      const engine = engineRef.current;
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (!next) break;

        setStatus(engine.id === "neural" ? "loading" : "speaking");

        let failed = false;
        await engine.speak(
          next,
          { voiceId: voiceIdRef.current, rate },
          {
            onStart: () => setStatus("speaking"),
            onPause: () => setStatus("paused"),
            onResume: () => setStatus("speaking"),
            onBoundary: (event) => {
              setHighlightIndex(event.charIndex);
            },
            onError: (message) => {
              failed = true;
              setError(message);
              setStatus("error");
              queueRef.current = [];
            },
          },
        );

        if (failed) return;
      }

      setStatus("idle");
      setHighlightIndex(null);
    },
    [engineId, rate],
  );

  const pause = useCallback(() => {
    engineRef.current.pause();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    engineRef.current.resume();
    setStatus("speaking");
  }, []);

  const stop = useCallback(() => {
    queueRef.current = [];
    engineRef.current.cancel();
    setStatus("idle");
    setHighlightIndex(null);
  }, []);

  const changeEngine = useCallback(
    (id: VoiceEngineId) => {
      stop();
      setEngineId(id);
      const engine = getSpeechEngine(id);
      engineRef.current = engine;
      void engine.listVoices().then((list) => {
        setVoices(list);
        setVoiceId((current) => pickDefaultVoice(list, current));
      });
    },
    [stop],
  );

  return {
    engineId,
    engines: ENGINE_OPTIONS.map((option) => ({
      ...option,
      available: option.id === "browser" ? true : neuralAvailable,
    })),
    changeEngine,
    voices,
    voiceId,
    setVoiceId,
    rate,
    setRate,
    status,
    error,
    setError,
    highlightIndex,
    speak,
    pause,
    resume,
    stop,
    neuralAvailable,
  };
}
