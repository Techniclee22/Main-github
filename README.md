# Read to Me

A **floating pill on your Mac desktop**. Pick an open window (like a PDF in Preview), tap **Read**, and hear it spoken in a natural English voice.

This is **not** a website you paste text into. It sits on top of whatever you already have open. You keep looking at the page — there is no separate follow-along popup.

## What you need

- A **Mac** (your PDF screenshot is Preview on macOS)
- [Node.js LTS](https://nodejs.org) installed (one-time)
- Screen Recording permission when macOS asks (required to see other windows)

## First-time setup

1. Open **Terminal** (Spotlight → type `Terminal` → Enter)
2. Get the project once:

```bash
cd ~
git clone https://github.com/Techniclee22/Main-github.git
cd Main-github
git checkout cursor/read-to-me-app-bbd6
chmod +x update-and-run.sh run.sh
./update-and-run.sh
```

After that, you almost never need the long command list again.

## Update & run (one command)

Whenever there’s a new fix, run this **one** line:

```bash
~/Main-github/update-and-run.sh
```

That fetches the latest code, installs anything new, and starts the pill.

## Just run (no update)

```bash
~/Main-github/run.sh
```

## How to use it (with your PDF)

1. Open your PDF in **Preview**
2. Click **Read** on the floating pill  
   — it reads the window you were just looking at. No picker needed.
3. Allow **Screen Recording** if macOS asks
4. Use **Pause / Resume / Stop** on the pill  
   — after Stop, click **Read** again anytime

Optional: the window button (▣) lets you force a specific window if auto-pick gets the wrong one.

## Natural English voice

The app uses the **same voice as Terminal** `say "…"` — your Mac Spoken Content / system voice.

On Mac, speech uses live system `say` so audio starts as soon as the page text is ready — no waiting to render audio files.

1. System Settings → Accessibility → Spoken Content → System Voice  
2. Pick an Enhanced/Premium English voice  
3. Confirm in Terminal: `say "This is my system voice"`  
4. Fully quit the app (Ctrl+C), then `~/Main-github/run.sh` and click **Read**

### Follow as you scroll

While reading, the app watches the window. When you stop scrolling, it re-reads and continues from the newly visible text. **Stop** turns follow off.

Speech now starts through live macOS `say` (no waiting to render audio files), and OCR uses a smaller capture so Read and scroll catch-up feel much snappier.


### Optional: cloud neural voice

```bash
export OPENAI_API_KEY="sk-..."   # or AI_GATEWAY_API_KEY for Vercel AI Gateway
cd ~/Main-github/desktop
npm start
```

## Two-column PDFs

Handbooks and magazines are read **left column top→bottom, then right column** — not straight across the page. Decorative chapter headers are skipped when possible.

## Keeping names consistent

The desktop app talks across **preload → main → renderer → TTS**. Those layers must use the **same** method names, IPC channels, DOM ids, and engine strings.

- Contract: [`desktop/api-contract.json`](desktop/api-contract.json)
- Rules: [`desktop/NAMING.md`](desktop/NAMING.md)
- Guard: `cd desktop && npm run check-api` (also runs before `npm start` / `update-and-run.sh`)

If a rename is needed, change the contract and every consumer in **one** commit — never one file alone.

## Project layout

| Folder | Role |
| --- | --- |
| `desktop/` | **The product** — Electron floating pill |
| `src/` | Earlier web experiment (secondary) |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Voice or scroll catch-up still feels slow | Run `~/Main-github/update-and-run.sh` for the live-`say` + faster OCR build |
| Empty window list | Open the PDF first, click Refresh in the picker |
| “No readable text” | Zoom in on the page, make sure the text is visible, try Read again |
| Can’t see other apps | Enable Screen Recording for the app in macOS Privacy settings |
| Voice didn’t change after Spoken Content setting | Fully quit the app, run `say "test"` in Terminal, then `~/Main-github/update-and-run.sh` |
| Reading pauses every line | Run `~/Main-github/update-and-run.sh` to get the latest build |
| Voice takes a long time to start | Run `~/Main-github/update-and-run.sh` — speech now streams the first short chunk while the rest prepares |
| Scroll doesn’t change what is read | Stay on the same window; after scrolling, wait a moment for it to settle; click Stop then Read if needed |
| `npm` not found | Install Node.js LTS from nodejs.org, then open a **new** Terminal |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
