import { NextRequest, NextResponse } from "next/server";
import { setActiveAccountForSession, hasAppSession, isSameOriginRequest } from "@/lib/session";

type Context = {
  params: Promise<{ userId: string }>;
};

export async function POST(_request: NextRequest, context: Context) {
  if (!(await hasAppSession())) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }
  if (!isSameOriginRequest(_request)) {
    return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  }

  const { userId } = await context.params;

  try {
    await setActiveAccountForSession(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ACCOUNT_SWITCH_FAILED";
    const status = code === "AUTH_REQUIRED" ? 401 : code === "ACCOUNT_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
