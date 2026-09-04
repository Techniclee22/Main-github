"use client";

import { useRef, useState } from "react";
import { CameraCapture } from "@/components/CameraCapture";
import { HighlightedText } from "@/components/HighlightedText";
import { useSpeech } from "@/hooks/use-speech";
import { recognizeImageText } from "@/lib/ocr";

type CaptureMode = "camera" | "upload" | "paste";

export function ReaderApp() {
  const [mode, setMode] = useState<CaptureMode>("camera");
  const [text, setText] = useState("");
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const speech = useSpeech();

  async function runOcr(source: File | Blob) {
    setBusy(true);
    setOcrStatus("Reading the image…");
    setOcrProgress(0);
    speech.setError(null);
    try {
      const result = await recognizeImageText(source, ({ status, progress }) => {
        setOcrStatus(status.replace(/_/g, " "));
        setOcrProgress(Math.round(progress * 100));
      });
      if (!result) {
        speech.setError(
          "No readable text was found. Try a clearer photo with good lighting.",
        );
        setOcrStatus(null);
        return;
      }
      setText(result);
      setOcrStatus("Text ready. Starting playback…");
      await speech.speak(result);
      setOcrStatus(null);
    } catch (error) {
      speech.setError(
        error instanceof Error
          ? error.message
          : "Could not read text from that image.",
      );
      setOcrStatus(null);
    } finally {
      setBusy(false);
      setOcrProgress(0);
    }
  }

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
        <h2 id="reader-heading">Point, capture, listen</h2>
        <p>
          Hold your device up to a page, sign, screen, or label. We extract the
          text on your device, then read it aloud.
        </p>
      </div>

      <div className="mode-tabs" role="tablist" aria-label="How to capture text">
        {(
          [
            ["camera", "Camera"],
            ["upload", "Photo"],
            ["paste", "Type or paste"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={`mode-tab${mode === id ? " is-active" : ""}`}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="capture-panel" role="tabpanel">
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
              placeholder="Paste or type anything you want spoken…"
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
                    : "Waiting for text"}
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

      <details className="settings">
        <summary>Voice &amp; speed</summary>
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
              onChange={(event) => speech.setRate(Number(event.target.value))}
            />
          </label>
        </div>
        <p className="hint">
          Natural voices use cloud TTS when configured. Device voices work
          offline and keep text on your device.
        </p>
      </details>
    </section>
  );
}
