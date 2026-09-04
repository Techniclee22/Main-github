# Read to Me

Device-agnostic assistive reader: point a phone, tablet, or computer at text and hear it spoken aloud.

Built for people who cannot easily read what is on a screen or in the world in front of them — blindness and low vision, dyslexia, literacy barriers, cognitive load, or temporary situations.

## What works today

- **Camera capture** — open the camera, snap a page/sign/screen, OCR runs on-device
- **Photo upload** — screenshots and images
- **Type or paste** — any text
- **Device voices** — browser Web Speech (free, can work offline)
- **Natural voices (optional)** — neural TTS via Vercel AI Gateway when configured
- **Voice & speed controls** — choose a voice and playback rate
- **Installable PWA** — add to home screen on phones and desktops

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Natural voices (optional)

Set an AI Gateway key for cloud neural TTS:

```bash
# .env.local
AI_GATEWAY_API_KEY=your_key
```

Without it, **Device voices** still work fully.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the capture → extract → voice → playback pipeline and the roadmap toward screen share, extensions, and OS integrations.

## Stack

- Next.js (App Router) + TypeScript
- Tesseract.js (on-device OCR)
- Web Speech API + Vercel AI Gateway TTS
- Progressive Web App manifest
