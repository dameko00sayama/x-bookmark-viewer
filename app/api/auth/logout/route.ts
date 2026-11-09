import { NextResponse } from "next/server";
import { clearAppSessionCookie, isSameOriginRequest } from "@/lib/session";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  }
  await clearAppSessionCookie();
  return NextResponse.json({ ok: true });
}
