"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CameraCaptureProps = {
  onCapture: (blob: Blob) => void;
  disabled?: boolean;
};

export function CameraCapture({ onCapture, disabled }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActive(true);
    } catch {
      setError(
        "Camera access was blocked. Allow camera permission, or upload a photo instead.",
      );
    }
  }, []);

  const snap = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCapture(blob);
          stop();
        }
      },
      "image/jpeg",
      0.92,
    );
  }, [onCapture, stop]);

  return (
    <div className="camera">
      {!active ? (
        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={start}
          disabled={disabled}
        >
          Open camera
        </button>
      ) : (
        <div className="camera-live">
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
            aria-label="Live camera preview"
          />
          <div className="camera-actions">
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={snap}
              disabled={disabled}
            >
              Capture &amp; read
            </button>
            <button type="button" className="btn btn-ghost" onClick={stop}>
              Close camera
            </button>
          </div>
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
