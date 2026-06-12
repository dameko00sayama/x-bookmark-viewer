import { NextRequest, NextResponse } from "next/server";
import { setActiveAccount } from "@/lib/db";

type Context = {
  params: Promise<{ userId: string }>;
};

export async function POST(_request: NextRequest, context: Context) {
  const { userId } = await context.params;

  try {
    setActiveAccount(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ACCOUNT_SWITCH_FAILED";
    const status = code === "ACCOUNT_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
