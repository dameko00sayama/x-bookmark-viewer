import { NextResponse } from "next/server";
import {
  getAuth,
  getCachedBookmarkPage,
  getMonthlyEstimatedApiCost,
  markBookmarksNotSeenOnX,
  saveSyncedBookmarkPage
} from "@/lib/db";
import { AuthRequiredError, BudgetExceededError, fetchBookmarks, XApiError } from "@/lib/x-api";

const PAGE_SIZE = 50;

function toErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  if (error instanceof BudgetExceededError) {
    return NextResponse.json({ error: "BUDGET_EXCEEDED" }, { status: 402 });
  }

  if (error instanceof XApiError) {
    const code =
      error.status === 402 ? "BILLING_REQUIRED" : error.status === 429 ? "RATE_LIMITED" : "X_API_FAILED";
    return NextResponse.json({ error: code, status: error.status }, { status: error.status });
  }

  return NextResponse.json({ error: "BOOKMARK_SYNC_FAILED" }, { status: 500 });
}

export async function POST() {
  try {
    if (!getAuth()) {
      throw new AuthRequiredError();
    }

    const seenTweetIds: string[] = [];
    let nextXToken: string | null = null;
    let offset = 0;

    do {
      const page = await fetchBookmarks(nextXToken);
      saveSyncedBookmarkPage(page.items, offset, page.nextToken);
      seenTweetIds.push(...page.items.map((item) => item.id));
      offset += page.items.length;
      nextXToken = page.nextToken;
    } while (nextXToken);

    const unbookmarkedCount = markBookmarksNotSeenOnX(seenTweetIds);
    const page = getCachedBookmarkPage(0, PAGE_SIZE);

    return NextResponse.json({
      ...page,
      source: "x",
      syncedCount: seenTweetIds.length,
      unbookmarkedCount,
      estimatedMonthlyCostUsd: getMonthlyEstimatedApiCost()
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
