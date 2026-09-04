# Read to Me

A **floating pill on your Mac desktop**. Pick an open window (like a PDF in Preview), tap **Read**, and hear it spoken in a natural voice — with a follow-along panel so you can read with it.

This is **not** a website you paste text into. It sits on top of whatever you already have open.

## What you need

- A **Mac** (your PDF screenshot is Preview on macOS)
- [Node.js LTS](https://nodejs.org) installed (one-time)
- Screen Recording permission when macOS asks (required to see other windows)

## First-time setup

1. Open **Terminal** (Spotlight → type `Terminal` → Enter)
2. Get the project and open the desktop app folder:

```bash
cd ~
git clone https://github.com/Techniclee22/Main-github.git
cd Main-github
git checkout cursor/read-to-me-app-bbd6
cd desktop
npm install
```

## Run the floating pill

```bash
cd ~/Main-github/desktop
npm start
```
A small pill appears near the bottom of your screen.

## How to use it (with your PDF)

1. Open your PDF in **Preview** (like `MB001_Mistborn_Handbook_digital.pdf`)
2. On the floating pill, click the **window** button (▣)
3. Click the Preview / PDF window in the list
4. Click **Read**
5. Allow **Screen Recording** if macOS asks (System Settings → Privacy & Security → Screen Recording → enable for Electron / Read to Me)
6. A **Follow along** panel opens with the text; the voice reads it aloud
7. Use **Pause / Resume / Stop** on the pill

Tip: Zoom the PDF a little if OCR misses small text. Turn pages, click **Read** again.

## Better / more natural voices on Mac

The app prefers **Premium / Enhanced** macOS voices (Zoe, Ava, Samantha, …) via the system `say` engine — much less robotic than the default browser voice.

1. System Settings → Accessibility → Spoken Content → System Voice  
   (or System Settings → Accessibility → Live Speech, depending on macOS version)
2. Download an **Enhanced** / **Premium** voice (e.g. Ava, Zoe, Samantha Enhanced)
3. Restart the app (`npm start`) so it can pick up the new voice

### Optional: cloud neural voice

For the most natural sound, set an API key before starting:

```bash
export OPENAI_API_KEY="sk-..."   # or AI_GATEWAY_API_KEY for Vercel AI Gateway
cd ~/Main-github/desktop
npm start
```

With a key present, Read uses a high-quality neural voice (`tts-1-hd`). Without one, it falls back to your Mac Premium/Enhanced voice.

## Two-column PDFs

Handbooks and magazines are read **left column top→bottom, then right column** — not straight across the page.

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
| `npm` not found | Install Node.js LTS from nodejs.org, then open a **new** Terminal |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
