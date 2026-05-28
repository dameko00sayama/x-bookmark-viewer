import { NextRequest, NextResponse } from "next/server";
import { getAuth, saveBookmarkNote } from "@/lib/db";

type Context = {
  params: Promise<{ tweetId: string }>;
};

export async function PUT(request: NextRequest, context: Context) {
  if (!getAuth()) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { tweetId } = await context.params;
  const payload = await request.json().catch(() => ({}));
  const note = typeof payload.note === "string" ? payload.note : "";

  saveBookmarkNote(tweetId, note);

  return NextResponse.json({ ok: true });
}
