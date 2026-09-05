# Read to Me

## Product

The product is a **Mac floating pill** in `desktop/`. It captures an open window, OCRs the page, and speaks it with live macOS `say`.

`src/` is a frozen Next.js experiment. Do not add features there unless the user asks to revive the web reader.

## Before you change names

The pill talks across preload, main, renderer, and TTS. Those layers must use the same method names, IPC channels, DOM ids, and engine strings.

1. Edit `desktop/api-contract.json` first.
2. Update every consumer in the same commit.
3. Run `npm --prefix desktop run check`.

Rules: `desktop/NAMING.md`. Guard: `desktop/scripts/check-api-contract.cjs`.

## Commands that must stay green

These run on Linux with no Electron binary and no `npm install` inside `desktop/`. CI and `.nvmrc` pin Node 22.

```bash
npm --prefix desktop run check
```

That runs the API contract check and `desktop/scripts/*.test.cjs`. `npm start` still runs only `check-api` so launch stays fast.

Do not add a test that needs macOS `say`, Screen Recording, or a live Electron window unless you also add a Linux-safe skip.

## Where to edit

| Change | Start here |
| --- | --- |
| Window pick, capture, OCR, highlight, scroll | `desktop/main.cjs` |
| Two-column reading order, quote cleanup | `desktop/lib/ocr-layout.cjs` |
| Live `say`, chunking, neural fallback | `desktop/lib/tts.cjs` |
| Read, Stop, and scroll-follow UI | `desktop/renderer/pill.js` |
| Speech session state | `desktop/renderer/speech.js` |
| IPC bridge | `desktop/preload.cjs` |

## Do not

- Rename `speakLive`, IPC channels, or pill DOM ids in one file only.
- Treat `src/` as the app.
- Point `update-and-run.sh` at a hard-coded feature branch. It fast-forwards the clone's current upstream. A dirty clone must print recovery steps, not `reset --hard` by default. `update-and-run-focus.sh` must stay an alias, not a second pin. Discarding a dirty `desktop/package-lock.json` before pull is allowed; that file is rewritten by `npm install`.
- Put `$BRANCH` next to a Unicode ellipsis in a launch script. Mac Terminal is zsh; `set -u` then treats `BRANCH…` as unset. Quote `${BRANCH}` and keep messages in ASCII.
- Describe a follow-along side panel or `speechSynthesis` as the desktop path. The desktop path is live `say` plus a reading-band overlay.
- Start a second speak loop without bumping `speakSession`. `stopFollow()` must not bump it.
- Assume `highlightReading({ sourceId })` or `scrollTargetWindow` honor `sourceId`. They use the frontmost external app.
- Add another renderer cancellation flag. The next session change belongs in main.
