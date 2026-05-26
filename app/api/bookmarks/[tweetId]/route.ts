import { NextRequest, NextResponse } from "next/server";
import { addBookmark, AuthRequiredError, removeBookmark, XApiError } from "@/lib/x-api";

type Context = {
  params: Promise<{ tweetId: string }>;
};

function toErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  if (error instanceof XApiError) {
    const code =
      error.status === 402 ? "BILLING_REQUIRED" : error.status === 429 ? "RATE_LIMITED" : "X_API_FAILED";
    return NextResponse.json({ error: code, status: error.status }, { status: error.status });
  }

  return NextResponse.json({ error: "BOOKMARK_OPERATION_FAILED" }, { status: 500 });
}

export async function DELETE(_request: NextRequest, context: Context) {
  const { tweetId } = await context.params;

  try {
    await removeBookmark(tweetId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(_request: NextRequest, context: Context) {
  const { tweetId } = await context.params;

  try {
    await addBookmark(tweetId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
