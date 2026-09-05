export type VoiceEngineId = "browser" | "neural";

export type SpeechVoice = {
  id: string;
  name: string;
  lang: string;
  localService?: boolean;
  engine: VoiceEngineId;
};

export type SpeakOptions = {
  voiceId?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
};

export type BoundaryEvent = {
  charIndex: number;
  charLength: number;
  name: string;
};

export type SpeechEngineEvents = {
  onStart?: () => void;
  onEnd?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onBoundary?: (event: BoundaryEvent) => void;
  onError?: (message: string) => void;
};

export type SpeechEngine = {
  id: VoiceEngineId;
  label: string;
  description: string;
  isAvailable: () => boolean | Promise<boolean>;
  listVoices: () => Promise<SpeechVoice[]>;
  speak: (
    text: string,
    options?: SpeakOptions,
    events?: SpeechEngineEvents,
  ) => Promise<void>;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  getSpeaking: () => boolean;
  getPaused: () => boolean;
};
