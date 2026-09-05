import {
  experimental_generateSpeech as generateSpeech,
} from "ai";
import { gateway } from "@ai-sdk/gateway";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CHARS = 4000;

function isConfigured() {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
}

export async function HEAD() {
  return new NextResponse(null, { status: isConfigured() ? 200 : 503 });
}

export async function POST(request: Request) {
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          "Natural voices are not configured yet. Add AI_GATEWAY_API_KEY, or use Device voices.",
      },
      { status: 503 },
    );
  }

  let body: { text?: string; voice?: string; speed?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "Text is required." }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `Text must be under ${MAX_CHARS} characters per request.` },
      { status: 400 },
    );
  }

  const voice = body.voice || "nova";
  const speed = Math.min(1.5, Math.max(0.75, body.speed ?? 1));

  try {
    const result = await generateSpeech({
      model: gateway.speechModel("openai/tts-1"),
      text,
      voice,
      speed,
      outputFormat: "mp3",
    });

    return new NextResponse(Buffer.from(result.audio.uint8Array), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Speech generation failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not generate natural speech.",
      },
      { status: 502 },
    );
  }
}
