"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ScreenCaptureProps = {
  onFrame: (blob: Blob) => void;
  disabled?: boolean;
  /** When true, periodically capture frames for live reading. */
  watchMode?: boolean;
  onWatchModeChange?: (enabled: boolean) => void;
};

function grabFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, width, height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function canShareScreen() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getDisplayMedia
  );
}

export function ScreenCapture({
  onFrame,
  disabled,
  watchMode = false,
  onWatchModeChange,
}: ScreenCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onFrameRef = useRef(onFrame);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(canShareScreen);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
    onWatchModeChange?.(false);
  }, [onWatchModeChange]);

  useEffect(() => () => stop(), [stop]);

  // Live watch: grab a frame every few seconds while sharing.
  useEffect(() => {
    if (!sharing || !watchMode || disabled) return;

    let cancelled = false;
    const tick = async () => {
      const video = videoRef.current;
      if (!video || cancelled) return;
      const blob = await grabFrame(video);
      if (blob && !cancelled) onFrameRef.current(blob);
    };

    const first = window.setTimeout(() => {
      void tick();
    }, 600);
    const id = window.setInterval(() => {
      void tick();
    }, 4500);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [sharing, watchMode, disabled]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "Screen sharing is not supported in this browser. Try Chrome, Edge, or Firefox on a computer — or use Camera / Photo on a phone.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 5, max: 15 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const [track] = stream.getVideoTracks();
      track?.addEventListener("ended", () => {
        stop();
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setSharing(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(
          "Screen share was cancelled or blocked. Choose a window, tab, or entire screen when the browser asks.",
        );
      } else {
        setError(
          "Could not start screen sharing. Try another browser, or use Camera / Photo instead.",
        );
      }
    }
  }, [stop]);

  const readNow = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const blob = await grabFrame(video);
    if (blob) onFrame(blob);
    else
      setError(
        "Could not capture the shared screen yet. Wait a moment and try again.",
      );
  }, [onFrame]);

  if (!supported) {
    return (
      <div className="screen-capture">
        <p className="status-error" role="alert">
          Screen sharing needs a desktop browser (Chrome, Edge, or Firefox). On
          a phone, use Camera or Photo to capture what is in front of you.
        </p>
      </div>
    );
  }

  return (
    <div className="screen-capture">
      <p className="screen-lede">
        Share a browser tab, PDF window, or your whole screen. Read to Me will
        look at it and speak the text it finds.
      </p>

      {!sharing ? (
        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={start}
          disabled={disabled}
        >
          Share screen to read
        </button>
      ) : (
        <div className="screen-live">
          <video
            ref={videoRef}
            className="screen-video"
            playsInline
            muted
            autoPlay
            aria-label="Shared screen preview"
          />
          <div className="screen-actions">
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={() => void readNow()}
              disabled={disabled}
            >
              Read this screen
            </button>
            <button
              type="button"
              className={`btn btn-ghost${watchMode ? " is-pressed" : ""}`}
              aria-pressed={watchMode}
              disabled={disabled}
              onClick={() => onWatchModeChange?.(!watchMode)}
            >
              {watchMode ? "Watching for changes…" : "Keep watching"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={stop}>
              Stop sharing
            </button>
          </div>
          <p className="hint">
            Scroll the shared window, then tap <strong>Read this screen</strong>
            again — or turn on <strong>Keep watching</strong> to re-read when
            the content changes.
          </p>
        </div>
      )}

      {error ? (
        <p className="status-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
