# Read to Me — Architecture

## Purpose

Device-agnostic reading assistance: **whatever is visible on a device** is spoken
aloud. Built for people who cannot read print, have low vision, dyslexia,
cognitive load limits, or temporary situational barriers.

The product is not a paste box. Paste is a fallback. The primary loop is:

```
Share screen (or point camera) → Extract text → Speak
```

## Pipeline

```
Capture → Extract text → Voice engine → Playback
```

| Stage | Now | Later |
| --- | --- | --- |
| Capture | **Screen share** (`getDisplayMedia`: tab, window, or entire display), camera, photo, paste fallback | Browser extension (DOM text), mobile share targets, OS accessibility APIs |
| Extract | Client OCR (Tesseract) on captured frames | Layout-aware reading order, multi-language, PDF text layer when available |
| Voice | Browser Web Speech; optional neural TTS via AI Gateway | User voice library, streaming neural voices |
| Playback | Play / pause / stop, rate, voice pick, highlight; optional “Keep watching” re-OCR | Continuous listen while scrolling, bookmarks, offline cache |
| Surfaces | Installable PWA | Native wrappers, watch controls |

## Screen share (primary)

1. User clicks **Share screen to read**.
2. Browser prompts for a tab, window (PDF reader, another app), or entire screen.
3. Live preview streams in the app.
4. **Read this screen** grabs a frame, runs OCR on-device, speaks the text.
5. **Keep watching** re-checks the shared surface every few seconds and speaks when the text changes (after scroll or navigation).

Privacy: shared frames are OCR’d locally in v1 and are not uploaded for the device-voice path.

## Voice engine contract

Engines implement `SpeechEngine`:

- `listVoices()` / `speak` / `pause` / `resume` / `cancel`
- Boundary events for word highlight

## Accessibility principles

- Large, labeled controls; keyboard operable
- Live regions for OCR and playback state
- Screen share is the default mode on load
- Camera / photo for phones and for text in the physical world
- Never rely on vision-only cues

## Roadmap phases

1. **Web screen share + OCR** (this codebase)
2. **Smarter extraction** (reading order, languages)
3. **Browser extension** for clean DOM text on websites
4. **OS-level hooks** where the platform allows reading other apps without share prompts
