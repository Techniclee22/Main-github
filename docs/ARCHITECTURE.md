# Read to Me — Architecture

## Purpose

Device-agnostic reading assistance: anything visible on (or pointed at by) a device is spoken aloud in a natural voice. Built for people who cannot read print, have low vision, dyslexia, cognitive load limits, or temporary situational barriers.

## Pipeline

```
Capture → Extract text → Voice engine → Playback
```

| Stage | v1 (now) | Later |
| --- | --- | --- |
| Capture | Paste/type, camera, image upload | Screen share, browser extension, OS accessibility hooks, PDF/DOCX |
| Extract | Client OCR (Tesseract), raw text | Cloud OCR, layout-aware reading order, multi-language |
| Voice | Browser Web Speech (free, offline-capable) | Neural TTS via Vercel AI Gateway (OpenAI / others), user voice library |
| Playback | Play / pause / stop, rate, voice pick, highlight | Continuous listening, bookmarks, offline cache, shareable audio |
| Surfaces | Installable PWA (phone, tablet, desktop) | Native wrappers, Wear OS / watch controls |

## Voice engine contract

All engines implement the same interface (`SpeechEngine`):

- `listVoices()` — selectable voices
- `speak(text, options)` — start / queue utterance
- `pause` / `resume` / `cancel`
- Events: `boundary` (word highlight), `end`, `error`

Switching engines must not change the UI. Neural engines stream or return audio that the player plays; browser engines use `speechSynthesis`.

## Accessibility principles

- Large, labeled controls; keyboard and screen-reader operable
- Live regions announce OCR progress and playback state
- High-contrast theme option
- Prefer device camera “point and read” over complex multi-step flows
- Never require vision-only cues (color alone, toast-only errors)

## Privacy

- v1 OCR and browser TTS stay on-device when possible
- Neural voices send text to the gateway only when the user opts into that engine
- Camera frames are processed locally for OCR and not uploaded in v1
