# Naming rules (Read to Me)

Identifier drift has broken the app more than once. These rules exist so it stops.

## Why it kept happening

The desktop app has **four layers that must use identical names**:

1. `renderer/pill.js` / `speech.js` — calls `window.readToMe.*` and DOM ids
2. `preload.cjs` — exposes those methods and maps them to IPC channel strings
3. `main.cjs` — `ipcMain.handle("channel-name", …)` and imports from `lib/tts.cjs`
4. `lib/tts.cjs` — exported function names

Each speed-up or follow fix rewrote several of those files. Without a frozen vocabulary, renames landed in one layer only (`speakLive` vs `speakNow`, `stopFollow` vs `stopFollowing`, `macos-say-live` vs `macos-say`, `pickerList` vs `windowList`). The app still looked fine. At runtime a call hit `undefined` and speech or follow quietly failed.

## Rules

1. **One contract file:** [`api-contract.json`](./api-contract.json) is the source of truth.
2. **Rename in one commit across every consumer** — never “fix names” in a single file.
3. **Prefer boring stable names.** Do not invent synonyms (`speakLive` / `speakNow` / `liveSay`).
4. **Engine strings are part of the contract** (`"macos-say-live"`, `"kokoro-live"`). `lib/tts.cjs` and `lib/kokoro-live.cjs` name them. `speech.js` reports `result.engine` and the guard rejects a live-engine literal there.
5. **DOM ids are part of the contract** (`pickBtn`, `targetLabel`, …).

## Automated guard

```bash
cd desktop
npm run check
```

`npm start`, `run.sh`, and `update-and-run.sh` still run `check-api` first so launch stays fast. `npm run check` adds the OCR and TTS unit tests. If preload, main, renderer, or tts disagree with the contract, the app **will not start**.

`readResultKeys` are asserted inside the `readWindowSource` function body. A `text:` elsewhere in `main.cjs` (Tesseract options) does not satisfy the gate.

When you intentionally rename something:

1. Edit `api-contract.json`
2. Update every matching call site
3. Run `npm run check`
4. Commit contract + consumers together
