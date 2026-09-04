# Read to Me — Architecture

## Product intent

A **desktop companion**: a floating pill over whatever you already have open (Preview PDFs, browsers, other apps). Tap Read → hear a natural voice → follow along in a side panel.

Not a website paste box. Not “open our site and share your screen into a browser tab” as the main UX.

## Core loop

```
Pick window → Capture frame → OCR → Natural TTS → Follow-along panel
```

## Surfaces

| Surface | Status |
| --- | --- |
| **Electron floating pill** (`desktop/`) | Primary — window picker, Read / Pause / Stop, follow-along |
| Web PWA (`src/`) | Secondary experiment; kept for later mobile / share-target ideas |

## Desktop stack (`desktop/`)

- **Electron** always-on-top frameless pill + reader window
- **desktopCapturer** to list windows and grab a high-res still of the chosen one
- **Tesseract.js** on-device OCR
- **speechSynthesis**, preferring macOS Enhanced / Premium voices

## Permissions (macOS)

Screen Recording is required so the app can see Preview / other apps. The OS prompts on first capture.

## Natural voice roadmap

1. **Now:** Best available system voices (Enhanced on macOS)
2. **Next:** Optional cloud neural TTS (AI Gateway) from the pill
3. **Later:** Voice picker UI, per-app profiles, continuous page-turn reading

## Later integrations

- Browser extension for clean DOM text on websites
- PDF text-layer extraction when the file is opened inside the app
- Global hotkey: “read frontmost window”
- Click-to-target overlay (“click this window”)

## Privacy

Window frames used for OCR stay on-device for the system-voice path.
