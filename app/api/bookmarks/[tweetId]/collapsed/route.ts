import { NextRequest, NextResponse } from "next/server";
import { getAuth, saveBookmarkCollapsed } from "@/lib/db";

type Context = {
  params: Promise<{ tweetId: string }>;
};

export async function PUT(request: NextRequest, context: Context) {
  if (!getAuth()) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { tweetId } = await context.params;
  const payload = await request.json().catch(() => ({}));
  const collapsed = payload.collapsed === true;

  saveBookmarkCollapsed(tweetId, collapsed);

  return NextResponse.json({ ok: true, collapsed });
}
