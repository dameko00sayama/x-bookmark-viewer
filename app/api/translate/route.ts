import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text = body.text ?? "";
    const target = body.target ?? "ja";

    if (!text) {
      return NextResponse.json({ error: "NO_TEXT" }, { status: 400 });
    }

    // Use libretranslate public instance as a best-effort translator.
    const resp = await fetch("https://libretranslate.de/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: "auto", target, format: "text" })
    });

    if (!resp.ok) {
      const fallback = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(
          target
        )}`
      );
      if (!fallback.ok) {
        throw new Error("TRANSLATION_FAILED");
      }
      const fb = await fallback.json();
      return NextResponse.json({ translatedText: fb.responseData.translatedText });
    }

    const payload = await resp.json();
    return NextResponse.json({ translatedText: payload.translatedText ?? payload.translated_text ?? payload });
  } catch (err) {
    return NextResponse.json({ error: "TRANSLATION_FAILED" }, { status: 500 });
  }
}
