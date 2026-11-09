import { NextRequest, NextResponse } from "next/server";
import { replaceBookmarkTags } from "@/lib/db";
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
  const tagIds = Array.isArray(payload.tagIds) ? payload.tagIds : [];
  const tags = replaceBookmarkTags(tweetId, tagIds);

  return NextResponse.json({ tags });
}
