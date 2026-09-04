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

1. Open your PDF in **Preview** (like `MB001_Mistborn_Handbook_digital.pdf`)
2. On the floating pill, click the **window** button (▣)
3. Click the Preview / PDF window in the list
4. Click **Read**
5. Allow **Screen Recording** if macOS asks (System Settings → Privacy & Security → Screen Recording → enable for Electron / Read to Me)
6. Keep looking at your PDF — the pill reads it aloud
7. Use **Pause / Resume / Stop** on the pill

Tip: Zoom the PDF a little if OCR misses small text. Turn pages, click **Read** again.

## Natural English voice

The app uses the **same voice as Terminal** `say "…"` — your Mac Spoken Content / system voice.

1. System Settings → Accessibility → Spoken Content → System Voice  
2. Pick an Enhanced/Premium English voice  
3. Confirm in Terminal: `say "This is my system voice"`  
4. Fully quit the app (Ctrl+C), then `~/Main-github/run.sh` and click **Read**

The status line should say it’s using your system voice.

### Optional: cloud neural voice

```bash
export OPENAI_API_KEY="sk-..."   # or AI_GATEWAY_API_KEY for Vercel AI Gateway
cd ~/Main-github/desktop
npm start
```

## Two-column PDFs

Handbooks and magazines are read **left column top→bottom, then right column** — not straight across the page. Decorative chapter headers are skipped when possible.

## Project layout

| Folder | Role |
| --- | --- |
| `desktop/` | **The product** — Electron floating pill |
| `src/` | Earlier web experiment (secondary) |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Empty window list | Open the PDF first, click Refresh in the picker |
| “No readable text” | Zoom in on the page, make sure the text is visible, try Read again |
| Can’t see other apps | Enable Screen Recording for the app in macOS Privacy settings |
| Voice didn’t change after Spoken Content setting | Fully quit the app, run `say "test"` in Terminal, then `~/Main-github/update-and-run.sh` |
| Reading pauses every line | Run `~/Main-github/update-and-run.sh` to get the latest build |
| Voice sounds foreign / wrong language | Set Spoken Content to an English Enhanced voice; restart with `~/Main-github/run.sh` |
| `npm` not found | Install Node.js LTS from nodejs.org, then open a **new** Terminal |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
