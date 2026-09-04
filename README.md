# Read to Me

Assistive reader that **sees what is on your screen** and speaks it aloud.

Share a browser tab, PDF window, or another app. Read to Me captures that
surface, extracts the text, and reads it — for people who cannot easily read
what is in front of them.

## What works today

- **Screen share (primary)** — pick a tab, window, or entire display; OCR runs on-device; text is spoken
- **Keep watching** — re-read when shared content changes (scroll / navigate)
- **Camera & photo** — point at paper, signs, or a second device
- **Paste** — optional fallback if you already have text
- **Device voices** — browser Web Speech (free, can work offline)
- **Natural voices (optional)** — neural TTS via Vercel AI Gateway when configured
- **Installable PWA**

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Click **Share screen to read**
2. Choose the tab/window/PDF you want spoken
3. Click **Read this screen**

Screen share needs a desktop browser (Chrome, Edge, or Firefox). On a phone, use Camera or Photo.

### Natural voices (optional)

```bash
# .env.local
AI_GATEWAY_API_KEY=your_key
```

Without it, device voices still work fully.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stack

- Next.js (App Router) + TypeScript
- Screen Capture API (`getDisplayMedia`)
- Tesseract.js (on-device OCR)
- Web Speech API + Vercel AI Gateway TTS
- Progressive Web App manifest
