import { NextRequest, NextResponse } from "next/server";
import { AuthRequiredError, XApiError, fetchTweet } from "@/lib/x-api";

type Context = {
  params: Promise<{ tweetId: string }>;
};

export async function GET(_request: NextRequest, context: Context) {
  const { tweetId } = await context.params;
  const url = new URL(_request.url);
  const expand = url.searchParams.get("expand");

  try {
    const tweet = await fetchTweet(tweetId, expand === "thread");
    return NextResponse.json(tweet);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
    }

    if (error instanceof XApiError) {
      const code =
        error.status === 402 ? "BILLING_REQUIRED" : error.status === 429 ? "RATE_LIMITED" : "X_API_FAILED";
      return NextResponse.json({ error: code, status: error.status }, { status: error.status });
    }

    return NextResponse.json({ error: "TWEET_FETCH_FAILED" }, { status: 500 });
  }
}
