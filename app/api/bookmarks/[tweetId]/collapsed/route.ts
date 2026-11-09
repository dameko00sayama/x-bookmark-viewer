import { NextRequest, NextResponse } from "next/server";
import { saveBookmarkCollapsed } from "@/lib/db";
import { hasAppSession, isSameOriginRequest } from "@/lib/session";

type Context = {
  params: Promise<{ tweetId: string }>;
};

export async function PUT(request: NextRequest, context: Context) {
  if (!(await hasAppSession()) || !isSameOriginRequest(request)) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { tweetId } = await context.params;
  const payload = await request.json().catch(() => ({}));
  const collapsed = payload.collapsed === true;

  saveBookmarkCollapsed(tweetId, collapsed);

  return NextResponse.json({ ok: true, collapsed });
}
