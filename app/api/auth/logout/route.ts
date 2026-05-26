import { NextResponse } from "next/server";
import { clearAuth } from "@/lib/db";

export async function POST() {
  clearAuth();
  return NextResponse.json({ ok: true });
}
