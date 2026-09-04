"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { HighlightedText } from "@/components/HighlightedText";
import { ScreenCapture } from "@/components/ScreenCapture";
import { useSpeech } from "@/hooks/use-speech";
import { recognizeImageText } from "@/lib/ocr";

type CaptureMode = "screen" | "camera" | "upload" | "paste";

function normalizeForCompare(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function ReaderApp() {
  const [mode, setMode] = useState<CaptureMode>("screen");
  const [text, setText] = useState("");
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [watchMode, setWatchMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastSpokenRef = useRef("");
  const ocrLockRef = useRef(false);

  const speech = useSpeech();
  const speakRef = useRef(speech.speak);
  const setErrorRef = useRef(speech.setError);

  useEffect(() => {
    speakRef.current = speech.speak;
    setErrorRef.current = speech.setError;
  }, [speech.speak, speech.setError]);

  const runOcr = useCallback(
    async (source: File | Blob, options?: { fromWatch?: boolean }) => {
      if (ocrLockRef.current) return;
      ocrLockRef.current = true;
      setBusy(true);
      setOcrStatus(
        options?.fromWatch
          ? "Checking the shared screen…"
          : "Reading what’s on screen…",
      );
      setOcrProgress(0);
      setErrorRef.current(null);

      try {
        const result = await recognizeImageText(
          source,
          ({ status, progress }) => {
            setOcrStatus(status.replace(/_/g, " "));
            setOcrProgress(Math.round(progress * 100));
          },
        );

        if (!result) {
          if (!options?.fromWatch) {
            setErrorRef.current(
              "No readable text was found on that screen. Try a clearer view, larger text, or scroll so more text is visible.",
            );
          }
          setOcrStatus(null);
          return;
        }

        const normalized = normalizeForCompare(result);
        if (
          options?.fromWatch &&
          normalized === normalizeForCompare(lastSpokenRef.current)
        ) {
          setOcrStatus("Same content — still watching…");
          window.setTimeout(() => setOcrStatus(null), 1200);
          return;
        }

        setText(result);
        lastSpokenRef.current = result;
        setOcrStatus("Text ready. Starting playback…");
        await speakRef.current(result);
        setOcrStatus(null);
      } catch (error) {
        setErrorRef.current(
          error instanceof Error
            ? error.message
            : "Could not read text from the shared screen.",
        );
        setOcrStatus(null);
      } finally {
        setBusy(false);
        setOcrProgress(0);
        ocrLockRef.current = false;
      }
    },
    [],
  );

  function onFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    void runOcr(file);
  }

  const isPlaying = speech.status === "speaking" || speech.status === "loading";
  const isPaused = speech.status === "paused";

  return (
    <section className="app-shell" aria-labelledby="reader-heading">
      <div className="app-intro">
        <h2 id="reader-heading">Share your screen. Hear it spoken.</h2>
        <p>
          Choose a browser tab, PDF, document, or another app window. Read to Me
          looks at what is shared and reads the text aloud — no copy-paste
          required.
        </p>
      </div>

      <div className="mode-tabs" role="tablist" aria-label="How to capture text">
        {(
          [
            ["screen", "Screen"],
            ["camera", "Camera"],
            ["upload", "Photo"],
            ["paste", "Paste"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            aria-controls="capture-panel"
            id={`mode-${id}`}
            className={`mode-tab${mode === id ? " is-active" : ""}`}
            onClick={() => {
              setWatchMode(false);
              setMode(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        id="capture-panel"
        className="capture-panel"
        role="tabpanel"
        aria-labelledby={`mode-${mode}`}
      >
        {mode === "screen" ? (
          <ScreenCapture
            disabled={busy}
            watchMode={watchMode}
            onWatchModeChange={setWatchMode}
            onFrame={(blob) =>
              void runOcr(blob, { fromWatch: watchMode })
            }
          />
        ) : null}

        {mode === "camera" ? (
          <CameraCapture
            onCapture={(blob) => void runOcr(blob)}
            disabled={busy}
          />
        ) : null}

        {mode === "upload" ? (
          <div className="upload-block">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => onFileChange(event.target.files)}
            />
            <button
              type="button"
              className="btn btn-primary btn-large"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Choose a photo
            </button>
            <p className="hint">
              Screenshots, book pages, menus, and signs work best.
            </p>
          </div>
        ) : null}

        {mode === "paste" ? (
          <label className="paste-label">
            <span className="sr-only">Text to read</span>
            <textarea
              className="paste-area"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Optional: paste text if you already have it…"
              rows={8}
            />
          </label>
        ) : null}
      </div>

      <div className="live-status" aria-live="polite" aria-atomic="true">
        {busy || ocrStatus ? (
          <p className="status-line">
            {ocrStatus ?? "Working…"}
            {ocrProgress > 0 ? ` (${ocrProgress}%)` : ""}
          </p>
        ) : null}
        {speech.error ? (
          <p className="status-error" role="alert">
            {speech.error}
          </p>
        ) : null}
        {speech.status === "loading" ? (
          <p className="status-line">Preparing natural voice…</p>
        ) : null}
      </div>

      <div className="reader-panel">
        <div className="reader-toolbar">
          <h3>Reading</h3>
          <span className="reader-meta" aria-live="polite">
            {speech.status === "idle" && text
              ? "Ready"
              : speech.status === "speaking"
                ? "Speaking"
                : speech.status === "paused"
                  ? "Paused"
                  : speech.status === "loading"
                    ? "Loading voice"
                    : "Waiting for screen text"}
          </span>
        </div>
        <div className="reader-scroll">
          <HighlightedText
            text={text}
            highlightIndex={speech.highlightIndex}
          />
        </div>
      </div>

      <div className="player" aria-label="Playback controls">
        {!isPlaying && !isPaused ? (
          <button
            type="button"
            className="btn btn-primary btn-large"
            disabled={busy || !text.trim()}
            onClick={() => void speech.speak(text)}
          >
            Read aloud
          </button>
        ) : null}

        {isPlaying ? (
          <button
            type="button"
            className="btn btn-primary btn-large"
            onClick={speech.pause}
          >
            Pause
          </button>
        ) : null}

        {isPaused ? (
          <button
            type="button"
            className="btn btn-primary btn-large"
            onClick={speech.resume}
          >
            Resume
          </button>
        ) : null}

        <button
          type="button"
          className="btn btn-ghost"
          disabled={speech.status === "idle"}
          onClick={speech.stop}
        >
          Stop
        </button>
      </div>

      <div className="settings">
        <button
          type="button"
          className="settings-toggle"
          aria-expanded={settingsOpen}
          aria-controls="voice-settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          Voice &amp; speed
        </button>
        {settingsOpen ? (
          <div id="voice-settings" className="settings-body">
            <div className="settings-grid">
              <label>
                Voice engine
                <select
                  value={speech.engineId}
                  onChange={(event) =>
                    speech.changeEngine(
                      event.target.value as "browser" | "neural",
                    )
                  }
                >
                  {speech.engines.map((engine) => (
                    <option
                      key={engine.id}
                      value={engine.id}
                      disabled={!engine.available && engine.id === "neural"}
                    >
                      {engine.label}
                      {!engine.available && engine.id === "neural"
                        ? " (not configured)"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Voice
                <select
                  value={speech.voiceId ?? ""}
                  onChange={(event) => speech.setVoiceId(event.target.value)}
                >
                  {speech.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Speed ({speech.rate.toFixed(1)}×)
                <input
                  type="range"
                  min={0.7}
                  max={1.6}
                  step={0.1}
                  value={speech.rate}
                  onChange={(event) =>
                    speech.setRate(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <p className="hint">
              Natural voices use cloud TTS when configured. Device voices work
              offline and keep text on your device.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
