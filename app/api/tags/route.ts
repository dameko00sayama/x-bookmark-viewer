import { NextRequest, NextResponse } from "next/server";
import { createTag, getAuth, getTags } from "@/lib/db";

function sanitizeColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#38bdf8";
}

export async function GET() {
  if (!getAuth()) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({ tags: getTags() });
}

export async function POST(request: NextRequest) {
  if (!getAuth()) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));
  const name = typeof payload.name === "string" ? payload.name : "";

  try {
    const tag = createTag(name, sanitizeColor(payload.color));
    return NextResponse.json({ tag }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TAG_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
