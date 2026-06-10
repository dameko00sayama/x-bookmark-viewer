import { NextRequest, NextResponse } from "next/server";
import { deleteTag, getAuth, updateTag } from "@/lib/db";

type Context = {
  params: Promise<{ tagId: string }>;
};

function parseTagId(value: string) {
  const tagId = Number(value);
  return Number.isInteger(tagId) && tagId > 0 ? tagId : null;
}

function sanitizeColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
}

export async function PUT(request: NextRequest, context: Context) {
  if (!getAuth()) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { tagId: rawTagId } = await context.params;
  const tagId = parseTagId(rawTagId);
  if (!tagId) {
    return NextResponse.json({ error: "TAG_NOT_FOUND" }, { status: 404 });
  }

  const payload = await request.json().catch(() => ({}));

  try {
    const tag = updateTag(tagId, {
      name: typeof payload.name === "string" ? payload.name : undefined,
      color: sanitizeColor(payload.color),
      sortOrder: typeof payload.sortOrder === "number" ? payload.sortOrder : undefined
    });
    return NextResponse.json({ tag });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TAG_UPDATE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "TAG_NOT_FOUND" ? 404 : 400 });
  }
}

export async function DELETE(_request: NextRequest, context: Context) {
  if (!getAuth()) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { tagId: rawTagId } = await context.params;
  const tagId = parseTagId(rawTagId);
  if (!tagId) {
    return NextResponse.json({ error: "TAG_NOT_FOUND" }, { status: 404 });
  }

  deleteTag(tagId);
  return NextResponse.json({ ok: true });
}
