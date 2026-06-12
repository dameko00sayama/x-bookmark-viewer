import { NextResponse } from "next/server";
import { getAccounts, getAuth } from "@/lib/db";

export async function GET() {
  const auth = getAuth();

  if (!auth) {
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
