import { NextRequest, NextResponse } from "next/server";
import {
  getCachedBookmarkCount,
  getCachedBookmarkPage,
  getAuth,
  getEstimatedApiUsageUsd,
  getSetting,
  saveCachedBookmarkPage
} from "@/lib/db";
import { AuthRequiredError, BudgetExceededError, fetchBookmarks, getApiChargeUsd, XApiError } from "@/lib/x-api";

const PAGE_SIZE = 50;

function encodeXToken(token: string | null) {
  return token ? `x:${encodeURIComponent(token)}` : null;
}

function nextTokenAfterCache(offset: number, itemCount: number) {
  const total = getCachedBookmarkCount();
  if (offset + itemCount < total) {
    return `cache:${offset + itemCount}`;
  }

  return encodeXToken(getSetting("bookmarks_next_x_token"));
}

async function fetchAndCacheXPage(paginationToken: string | null, offset: number) {
  const page = await fetchBookmarks(paginationToken);
  const items = saveCachedBookmarkPage(page.items, offset, page.nextToken);

  return {
    items,
    nextToken: nextTokenAfterCache(offset, items.length),
    source: "x",
    apiChargeUsd: getApiChargeUsd(),
    estimatedApiUsageUsd: getEstimatedApiUsageUsd()
  };
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const token = params.get("pagination_token");
  const refresh = params.get("refresh") === "1";

  try {
    if (!getAuth()) {
      throw new AuthRequiredError();
    }

    if (refresh) {
      const response = await fetchAndCacheXPage(null, 0);
      return NextResponse.json(response);
    }

    if (token?.startsWith("x:")) {
      const xToken = decodeURIComponent(token.slice(2));
      const response = await fetchAndCacheXPage(xToken, getCachedBookmarkCount());
      return NextResponse.json(response);
    }

    const offset = token?.startsWith("cache:") ? Number(token.slice(6)) : 0;
    const cacheOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const page = getCachedBookmarkPage(cacheOffset, PAGE_SIZE);

    return NextResponse.json({
      ...page,
      nextToken: page.nextToken ?? encodeXToken(getSetting("bookmarks_next_x_token")),
      source: "cache",
      apiChargeUsd: getApiChargeUsd(),
      estimatedApiUsageUsd: getEstimatedApiUsageUsd()
    });
  } catch (error) {
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

    return NextResponse.json({ error: "BOOKMARK_FETCH_FAILED" }, { status: 500 });
  }
}
