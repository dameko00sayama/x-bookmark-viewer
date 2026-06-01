import { NextResponse } from "next/server";
import {
  getActiveCachedBookmarkIds,
  getAuth,
  getCachedBookmarkPage,
  getEstimatedApiUsageUsd,
  markBookmarksNotSeenOnX,
  saveSyncedBookmarkPage
} from "@/lib/db";
import { AuthRequiredError, BudgetExceededError, fetchBookmarks, getApiChargeUsd, XApiError } from "@/lib/x-api";

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

    const targetTweetIds = getActiveCachedBookmarkIds();
    const targetTweetIdSet = new Set(targetTweetIds);
    const seenTweetIds: string[] = [];
    let nextXToken: string | null = null;
    let offset = 0;

    if (targetTweetIds.length > 0) {
      do {
        const page = await fetchBookmarks(nextXToken);
        const targetItems = page.items.filter((item) => targetTweetIdSet.has(item.id));

        if (targetItems.length > 0) {
          saveSyncedBookmarkPage(targetItems, offset);
          seenTweetIds.push(...targetItems.map((item) => item.id));
          offset += targetItems.length;
        }

        nextXToken = page.nextToken;
      } while (nextXToken && seenTweetIds.length < targetTweetIds.length);
    }

    const unbookmarkedCount = markBookmarksNotSeenOnX(seenTweetIds, targetTweetIds);
    const page = getCachedBookmarkPage(0, PAGE_SIZE);

    return NextResponse.json({
      ...page,
      source: "x",
      syncedCount: seenTweetIds.length,
      syncTargetCount: targetTweetIds.length,
      unbookmarkedCount,
      apiChargeUsd: getApiChargeUsd(),
      estimatedApiUsageUsd: getEstimatedApiUsageUsd()
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
