import { NextRequest, NextResponse } from "next/server";
import {
  getActiveCachedBookmarkCount,
  getBookmarkNextXToken,
  getCachedBookmarkPage,
  getEstimatedApiUsageUsd,
  saveCachedBookmarkPage
} from "@/lib/db";
import { AuthRequiredError, BudgetExceededError, fetchBookmarks, getApiChargeUsd, XApiError } from "@/lib/x-api";
import { hasAppSession, isSameOriginRequest } from "@/lib/session";

const PAGE_SIZE = 50;

function encodeXToken(token: string | null) {
  return token ? `x:${encodeURIComponent(token)}` : null;
}

// Ordinary paging exposes only SQLite cursors. X paging requires an explicit fetch action.
async function fetchAndCacheXPage(paginationToken: string | null, offset: number) {
  const page = await fetchBookmarks(paginationToken);
  saveCachedBookmarkPage(page.items, offset, page.nextToken);

  return {
    ...getCachedBookmarkPage(0, PAGE_SIZE),
    nextXToken: encodeXToken(page.nextToken),
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
    if (!(await hasAppSession()) || !isSameOriginRequest(request)) {
      throw new AuthRequiredError();
    }

    if (token && !token.startsWith("cache:") && !(refresh && token.startsWith("x:"))) {
      return NextResponse.json({ error: "INVALID_PAGINATION_TOKEN" }, { status: 400 });
    }

    if (refresh) {
      const xToken = token?.startsWith("x:") ? decodeURIComponent(token.slice(2)) : null;
      const response = await fetchAndCacheXPage(xToken, xToken ? getActiveCachedBookmarkCount() : 0);
      return NextResponse.json(response);
    }

    const offset = token?.startsWith("cache:") ? Number(token.slice(6)) : 0;
    const cacheOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
    const page = getCachedBookmarkPage(cacheOffset, PAGE_SIZE);

    return NextResponse.json({
      ...page,
      nextXToken: encodeXToken(getBookmarkNextXToken()),
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
