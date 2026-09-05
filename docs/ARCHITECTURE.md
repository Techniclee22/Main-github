# About the Read to Me architecture

## What this is

Read to Me is a Mac desktop companion. A small always-on-top pill sits over Preview, a browser, or any other window. Tap Read. The app captures that window, rebuilds the page text with OCR, and speaks it through live macOS `say`.

It is not a website you paste into. The Next.js tree under `src/` is an earlier experiment and is frozen.

## Core loop

```
frontmost window → PNG capture → Tesseract words → column reflow → live say
```

While speech is running, a dim reading band overlays the target window. Scroll-follow peeks at the page. After the view settles, it OCRs again and continues from the newly visible text.

## Key pieces

**Pill renderer.** `desktop/renderer/pill.js` owns Read, Pause, Resume, Stop, the window picker, and scroll-follow timers. It calls `window.readToMe.*` and `ReadToMeSpeech`.

**Speech session.** `desktop/renderer/speech.js` arms one speak loop at a time. `pill.js` splits the page into sentences and calls `speakLive` once per sentence. The WAV helper and cloud neural path have no Read call site. If live `say` fails, the fallback is Chromium `speechSynthesis`.

**Main process.** `desktop/main.cjs` lists windows, picks the one that matches the frontmost app's window title, captures a PNG, runs Tesseract, shows the highlight overlay, and scrolls the target with AppleScript.

**OCR layout.** `desktop/lib/ocr-layout.cjs` turns word boxes into speech text. Two-column pages read left column top to bottom, then right. Curly quotes become ASCII so `say` does not turn "don't" into "don t".

**TTS.** `desktop/lib/tts.cjs` starts `say -r 185 -f <tempfile>` without `-v` on macOS, so Spoken Content supplies the voice. Cloud neural TTS is implemented on `synthesize-speech` and is not on the Read path.

**Name contract.** `desktop/api-contract.json` is the vocabulary for IPC methods, TTS exports, DOM ids, and engine strings. `desktop/scripts/check-api-contract.cjs` fails the process if a layer drifts.

## How Read works

1. The user taps Read, or picks a window with the picker.
2. `pill.js` calls `readActiveWindow` or `readWindowById`.
3. `main.cjs` captures the window, prepares the image, and OCRs it.
4. `textFromOcrPage` rebuilds reading order and boxed words.
5. `pill.js` splits the prose into sentences. Each sentence is one `speakLive` and one `say` process. Pause is a no-op in the gap between sentences.
6. Follow starts. Peek captures compare luminance. A large still shift triggers a new OCR. Stop clears follow and kills `say`.

```mermaid
sequenceDiagram
  participant Pill as pill.js
  participant Bridge as preload.cjs
  participant Main as main.cjs
  participant OCR as ocr-layout.cjs
  participant Say as macOS say

  Pill->>Bridge: readActiveWindow()
  Bridge->>Main: read-active-window
  Main->>Main: capture PNG + Tesseract
  Main->>OCR: textFromOcrPage(words)
  OCR-->>Main: prose, columns, boxed words
  Main-->>Pill: { text, id, words }
  loop each sentence
    Pill->>Bridge: speakLive(sentence)
    Bridge->>Main: speak-live
    Main->>Say: spawn say -f tempfile
    Pill->>Bridge: highlightReading({ sourceId, fraction })
  end
```

## Where things live

| Path | Role |
| --- | --- |
| `desktop/` | The product |
| `desktop/main.cjs` | Capture, OCR worker, windows, highlight, scroll |
| `desktop/lib/ocr-layout.cjs` | Reading order (Linux-testable) |
| `desktop/lib/tts.cjs` | Live `say` and fallbacks (reflow/chunk Linux-testable) |
| `desktop/renderer/pill.js` | Follow state and playback UI |
| `desktop/api-contract.json` | Frozen names |
| `src/` | Frozen web experiment |
| `run.sh` / `update-and-run.sh` | Mac launch helpers |

## Gotchas

Identifier drift has already broken speech. Change names in the contract and every consumer together.

`app.on("window-all-closed")` quits only off Mac. The app still starts on Linux. Unit tests never load Electron.

`desktop/renderer/speech.js` still contains `speechSynthesis`. `pill.js` calls `speech.speakLive` first. If live `say` fails on Mac, `synthesizeSpeechChunk` returns empty `parts`, so the fallback is browser TTS, not neural and not a WAV file.

Highlight and Page Down ignore the Electron `sourceId` the pill passes. They use the frontmost external app from AppleScript. Capture uses `source.id`. Two Preview windows can OCR one frame and paint the band on the other.

Page Down is a no-op while the pill holds focus. Scroll-follow after the user scrolls is the path that actually advances.

`synthesize-speech` IPC is live. If `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` is set, that handler may send page text to the cloud. Read does not call it.

Follow state in `pill.js` is a handful of timers and generation counters (`speakSession`, `followGeneration`, `followTargetId`). Those exist because an older loop kept talking after retarget. Do not start a second speak loop without bumping `speakSession`. `stopFollow()` must not bump `speakSession`. `startFollow()` calls it mid-Read.

OCR layout returns word boxes on the read payload (`words`) so a later band can use them. The pill still maps highlight by sentence fraction. Do not add another consumer of the string-only shape.

Two-column split requires a gap between left-column box edges and right-column box edges. A busy page-center band is not enough to refuse a split.

Electron `source.name` is the window title. Terminal tabs look like `Main-github — -zsh — 81×30`, not `Terminal`. Match the focused app's window titles, not the process name substring.

Dark captures (Terminal) invert before OCR. Peek flicker on a dark UI is not a page scroll and must not stop `say`.

A previous `say` close handler used to unlink `liveSayTempFile`, which could be the next sentence's file. Cleanup now unlinks only the file that spawn owned.

The last Mac report was speech stopping after a few words. The tempfile fix is the likely root cause. It has not been retested on a Mac.

`update-and-run.sh` fast-forwards whatever branch the clone is on. It does not pin a Cursor feature branch and it does not `reset --hard`. If `git pull --ff-only` fails (local edits, or `npm install` rewriting `desktop/package-lock.json`), the script prints stash / reset / checkout-main recovery instead of a raw git error.

CI pins Node 22 (`.nvmrc`). Node 20 reached end-of-life on 2026-04-30.

The next expensive change is a reading session in main that owns target, `say`, and follow. Do not add another renderer flag instead.

## Privacy

The system-voice path keeps window frames on-device. Read does not call cloud TTS. The unused `synthesize-speech` handler will send page text if `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` is set.
