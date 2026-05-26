import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, fetchBookmarks, XApiError } from "@/lib/x-api";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("pagination_token");

  try {
    const page = await fetchBookmarks(token);
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    }

    if (error instanceof XApiError) {
      const code =
        error.status === 402 ? "BILLING_REQUIRED" : error.status === 429 ? "RATE_LIMITED" : "X_API_FAILED";
      return NextResponse.json({ error: code, status: error.status }, { status: error.status });
    }

    return NextResponse.json({ error: "BOOKMARK_FETCH_FAILED" }, { status: 500 });
  }
}
