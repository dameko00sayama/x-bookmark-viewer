import { NextResponse } from "next/server";
import { getAccounts, getAuth } from "@/lib/db";
import { getAppSessionUser } from "@/lib/session";

export async function GET() {
  const sessionUserId = await getAppSessionUser();
  const auth = getAuth();

  if (!auth || !sessionUserId) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    userId: auth.userId,
    username: auth.username ?? null,
    name: auth.name ?? null,
    accounts: getAccounts()
  });
}
