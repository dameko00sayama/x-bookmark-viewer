import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text = body.text ?? "";
    const target = body.target ?? "ja";

    if (!text) {
      return NextResponse.json({ error: "NO_TEXT" }, { status: 400 });
    }

    // Use Google Translate unofficial endpoint first for better availability.
    const google = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(
        target
      )}&dt=t&q=${encodeURIComponent(text)}`
    );
    if (google.ok) {
      const rawGoogle = await google.text();
      try {
        const parsedGoogle = JSON.parse(rawGoogle);
        const parts = (parsedGoogle[0] || []).map((seg: any) => seg[0]).filter(Boolean);
        if (parts.length > 0) {
          return NextResponse.json({ translatedText: parts.join("") });
        }
      } catch (e) {
        // ignore and try fallback
      }
    }

    // Fallback to libretranslate public instance.
    const resp = await fetch("https://de.libretranslate.com/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: "auto", target, format: "text" })
    });
    if (resp.ok) {
      const raw = await resp.text().catch(() => "");
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        parsed = null;
      }

      const translated = parsed?.translatedText ?? parsed?.translated_text ?? null;
      if (translated) {
        return NextResponse.json({ translatedText: translated });
      }
    }

    // Try MyMemory fallback.
    try {
      const fallback = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${encodeURIComponent(
          target
        )}`
      );
      if (fallback.ok) {
        const fb = await fallback.json().catch(() => null);
        if (fb?.responseData?.translatedText) {
          return NextResponse.json({ translatedText: fb.responseData.translatedText });
        }
      }
    } catch (e) {
      // ignore
    }

    return NextResponse.json({ error: "TRANSLATION_FAILED" }, { status: 502 });
  } catch (err) {
    return NextResponse.json({ error: "TRANSLATION_FAILED" }, { status: 500 });
  }
}
