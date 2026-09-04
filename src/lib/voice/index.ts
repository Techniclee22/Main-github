import { createBrowserSpeechEngine } from "./browser-engine";
import { createNeuralSpeechEngine } from "./neural-engine";
import type { SpeechEngine, VoiceEngineId } from "./types";

export function getSpeechEngine(id: VoiceEngineId): SpeechEngine {
  switch (id) {
    case "neural":
      return createNeuralSpeechEngine();
    case "browser":
    default:
      return createBrowserSpeechEngine();
  }
}

export const ENGINE_OPTIONS: {
  id: VoiceEngineId;
  label: string;
  description: string;
}[] = [
  {
    id: "browser",
    label: "Device voices",
    description: "Free, works offline on your device",
  },
  {
    id: "neural",
    label: "Natural voices",
    description: "Cloud neural TTS (when configured)",
  },
];

export type {
  SpeechEngine,
  SpeechVoice,
  VoiceEngineId,
  SpeakOptions,
  BoundaryEvent,
} from "./types";
