"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookmarkTweet } from "@/lib/x-api";
import packageJson from "@/package.json";
import BookmarkCard from "./BookmarkCard";
import ImageModal from "./ImageModal";
import LoginPanel from "./LoginPanel";

type BookmarkResponse = {
  items: BookmarkTweet[];
  nextToken: string | null;
  source?: "cache" | "x";
  apiChargeUsd?: number;
  estimatedApiUsageUsd?: number;
  syncedCount?: number;
  syncTargetCount?: number;
  unbookmarkedCount?: number;
  error?: string;
};

type AuthState = "checking" | "anonymous" | "authenticated";
type LoadingMode = "cache" | "refresh" | "sync" | "more";

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "認証が切れています。再ログインしてください。",
  BILLING_REQUIRED:
    "X APIが402を返しました。Developer PortalでAPIアクセスプラン、支払い設定、対象Appの権限を確認してください。",
  RATE_LIMITED: "X APIの制限に達しました。しばらく待ってから更新してください。",
  X_API_FAILED: "X APIの取得に失敗しました。",
  BOOKMARK_FETCH_FAILED: "ブックマークの取得に失敗しました。",
  BOOKMARK_SYNC_FAILED: "ブックマークの同期に失敗しました。",
  BOOKMARK_OPERATION_FAILED: "ブックマーク操作に失敗しました。",
  BUDGET_EXCEEDED: "X APIのチャージ総額を超えそうなので、ローカルキャッシュだけ表示しています。",
  oauth_state: "OAuth認証を安全に完了できませんでした。もう一度ログインしてください。",
  oauth_failed: "X OAuth認証に失敗しました。設定を確認して再ログインしてください。",
  missing_config: ".env の X_CLIENT_ID が未設定です。設定後に docker-compose up -d --build で再起動してください。"
};

export default function BookmarkViewer() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [items, setItems] = useState<BookmarkTweet[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loadingMode, setLoadingMode] = useState<LoadingMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<BookmarkResponse["source"] | null>(null);
  const [refreshSucceeded, setRefreshSucceeded] = useState(false);
  const [syncSucceeded, setSyncSucceeded] = useState(false);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [apiChargeUsd, setApiChargeUsd] = useState<number | null>(null);
  const [estimatedApiUsageUsd, setEstimatedApiUsageUsd] = useState<number | null>(null);
  const [modalImage, setModalImage] = useState<{ url: string; altText: string | null } | null>(null);
  const [undoTweet, setUndoTweet] = useState<BookmarkTweet | null>(null);
  const nextTokenRef = useRef<string | null>(null);
  const refreshDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loginError = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("error");
    const reason = params.get("reason");
    if (!raw) {
      return null;
    }
    const message = ERROR_MESSAGES[raw] ?? raw;
    return reason ? `${message} (${reason})` : message;
  }, []);

  const loadBookmarks = useCallback(
    async (mode: "cache" | "refresh" | "more") => {
      if (refreshDoneTimerRef.current) {
        clearTimeout(refreshDoneTimerRef.current);
        refreshDoneTimerRef.current = null;
      }
      setLoadingMode(mode);
      setError(null);
      if (mode === "refresh") {
        setRefreshSucceeded(false);
      }
      setSyncSummary(null);

      const params = new URLSearchParams();
      if (mode === "refresh") {
        params.set("refresh", "1");
      }
      if (mode === "more" && nextTokenRef.current) {
        params.set("pagination_token", nextTokenRef.current);
      }

      try {
        const response = await fetch(`/api/bookmarks${params.size ? `?${params}` : ""}`);
        const payload = (await response.json()) as BookmarkResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "BOOKMARK_FETCH_FAILED");
        }

        setItems((current) => (mode === "more" ? [...current, ...payload.items] : payload.items));
        nextTokenRef.current = payload.nextToken;
        setNextToken(payload.nextToken);
        setLastSource(payload.source ?? null);
        setApiChargeUsd(payload.apiChargeUsd ?? null);
        setEstimatedApiUsageUsd(payload.estimatedApiUsageUsd ?? null);
        setUndoTweet(null);
        if (mode === "refresh") {
          setRefreshSucceeded(true);
          refreshDoneTimerRef.current = setTimeout(() => {
            setRefreshSucceeded(false);
            refreshDoneTimerRef.current = null;
          }, 2400);
        }
      } catch (caught) {
        const code = caught instanceof Error ? caught.message : "BOOKMARK_FETCH_FAILED";
        setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.BOOKMARK_FETCH_FAILED);
        if (code === "AUTH_REQUIRED") {
          setAuth("anonymous");
        }
      } finally {
        setLoadingMode(null);
      }
    },
    []
  );

  async function syncBookmarks() {
    const ok = window.confirm(
      "ローカルに取得済みのブックマークだけをX側と照合します。確認のためX API料金が発生する可能性があります。実行しますか？"
    );
    if (!ok) {
      return;
    }

    if (refreshDoneTimerRef.current) {
      clearTimeout(refreshDoneTimerRef.current);
      refreshDoneTimerRef.current = null;
    }

    setLoadingMode("sync");
    setError(null);
    setSyncSucceeded(false);
    setSyncSummary(null);

    try {
      const response = await fetch("/api/bookmarks/sync", { method: "POST" });
      const payload = (await response.json()) as BookmarkResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "BOOKMARK_SYNC_FAILED");
      }

      setItems(payload.items);
      nextTokenRef.current = payload.nextToken;
      setNextToken(payload.nextToken);
      setLastSource(payload.source ?? null);
      setApiChargeUsd(payload.apiChargeUsd ?? null);
      setEstimatedApiUsageUsd(payload.estimatedApiUsageUsd ?? null);
      setUndoTweet(null);
      setSyncSummary(
        `取得済み${payload.syncTargetCount ?? 0}件中${payload.syncedCount ?? 0}件をX側で確認、${
          payload.unbookmarkedCount ?? 0
        }件を解除済みにしました。`
      );
      setSyncSucceeded(true);
      refreshDoneTimerRef.current = setTimeout(() => {
        setSyncSucceeded(false);
        refreshDoneTimerRef.current = null;
      }, 2400);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "BOOKMARK_SYNC_FAILED";
      setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.BOOKMARK_SYNC_FAILED);
      if (code === "AUTH_REQUIRED") {
        setAuth("anonymous");
      }
    } finally {
      setLoadingMode(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      const response = await fetch("/api/auth/me");
      const payload = await response.json();

      if (cancelled) {
        return;
      }

      if (payload.authenticated) {
        setAuth("authenticated");
        await loadBookmarks("cache");
      } else {
        setAuth("anonymous");
      }
    }

    checkAuth().catch(() => {
      if (!cancelled) {
        setAuth("anonymous");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadBookmarks]);

  useEffect(() => {
    return () => {
      if (refreshDoneTimerRef.current) {
        clearTimeout(refreshDoneTimerRef.current);
      }
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuth("anonymous");
    setItems([]);
    nextTokenRef.current = null;
    setNextToken(null);
    setUndoTweet(null);
  }

  async function removeBookmark(tweet: BookmarkTweet) {
    const ok = window.confirm("このポストのブックマークを解除しますか？");
    if (!ok) {
      return;
    }

    setError(null);
    const previousItems = items;
    setItems((current) => current.filter((item) => item.id !== tweet.id));

    try {
      const response = await fetch(`/api/bookmarks/${tweet.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "BOOKMARK_OPERATION_FAILED");
      }
      setUndoTweet(tweet);
    } catch (caught) {
      setItems(previousItems);
      const code = caught instanceof Error ? caught.message : "BOOKMARK_OPERATION_FAILED";
      setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.BOOKMARK_OPERATION_FAILED);
    }
  }

  async function undoRemove() {
    if (!undoTweet) {
      return;
    }

    const tweet = undoTweet;
    setError(null);

    try {
      const response = await fetch(`/api/bookmarks/${tweet.id}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "BOOKMARK_OPERATION_FAILED");
      }
      setItems((current) => [tweet, ...current]);
      setUndoTweet(null);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "BOOKMARK_OPERATION_FAILED";
      setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.BOOKMARK_OPERATION_FAILED);
    }
  }

  if (auth === "checking") {
    return (
      <main className="mx-auto flex min-h-screen max-w-[760px] items-center justify-center px-6 text-quiet">
        読み込み中
      </main>
    );
  }

  if (auth === "anonymous") {
    return <LoginPanel error={loginError ?? error} />;
  }

  const version = packageJson.version ?? "0.0.0";
  const loading = loadingMode !== null;
  const refreshLoading = loadingMode === "refresh";
  const syncLoading = loadingMode === "sync";
  const sourceLabel =
    lastSource === "x" ? "X APIから取得済み" : lastSource === "cache" ? "ローカルキャッシュを表示中" : null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[760px] px-6 py-8">
      <header className="sticky top-0 z-20 -mx-6 mb-6 border-b border-line bg-ink/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[760px] items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">X Bookmark Viewer</h1>
            <p className="text-sm text-quiet">ブックマーク専用</p>
            <p className="text-xs text-slate-400">v{version}</p>
            {sourceLabel ? <p className="text-xs text-sky-200">{sourceLabel}</p> : null}
            {apiChargeUsd !== null && estimatedApiUsageUsd !== null ? (
              <p className="text-xs text-slate-400">
                X APIチャージ / 使用量 ${apiChargeUsd} / ${estimatedApiUsageUsd.toFixed(2)}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-panel"
              onClick={() => loadBookmarks("refresh")}
              disabled={loading}
            >
              <span className="flex min-w-[5.5rem] items-center justify-center gap-2">
                {refreshLoading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-90"
                      fill="currentColor"
                      d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
                    />
                  </svg>
                ) : refreshSucceeded ? (
                  <svg className="h-4 w-4 text-emerald-300" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="3"
                      d="M20 6 9 17l-5-5"
                    />
                  </svg>
                ) : null}
                {refreshLoading ? "取得中" : refreshSucceeded ? "取得済み" : "取得"}
              </span>
            </button>
            <button
              type="button"
              className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-panel"
              onClick={syncBookmarks}
              disabled={loading}
            >
              <span className="flex min-w-[5.5rem] items-center justify-center gap-2">
                {syncLoading ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-90"
                      fill="currentColor"
                      d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
                    />
                  </svg>
                ) : syncSucceeded ? (
                  <svg className="h-4 w-4 text-emerald-300" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="3"
                      d="M20 6 9 17l-5-5"
                    />
                  </svg>
                ) : null}
                {syncLoading ? "同期中" : syncSucceeded ? "同期済み" : "同期"}
              </span>
            </button>
            <button
              type="button"
              className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-panel"
              onClick={logout}
            >
              ログアウト
            </button>
          </div>
        </div>
        {refreshLoading || syncLoading ? (
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-line">
            <div className="h-full w-1/3 animate-[refresh-progress_1.1s_ease-in-out_infinite] bg-sky-400" />
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="mb-5 rounded-md border border-red-400/40 bg-red-950/40 p-4 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {syncSummary ? (
        <div className="mb-5 rounded-md border border-sky-400/40 bg-sky-950/30 p-4 text-sm text-sky-100">
          {syncSummary}
        </div>
      ) : null}

      {undoTweet ? (
        <div className="mb-5 flex items-center justify-between rounded-md border border-emerald-400/40 bg-emerald-950/30 p-4 text-sm text-emerald-100">
          <span>ブックマークを解除しました。</span>
          <button type="button" className="font-semibold underline" onClick={undoRemove}>
            元に戻す
          </button>
        </div>
      ) : null}

      <section className="space-y-4">
        {items.map((tweet) => (
          <BookmarkCard
            key={tweet.id}
            tweet={tweet}
            onRemove={removeBookmark}
            onImageClick={setModalImage}
          />
        ))}
      </section>

      {items.length === 0 && !loading ? (
        <div className="rounded-lg border border-line bg-panel p-8 text-center text-quiet">
          表示できるブックマークがありません。
        </div>
      ) : null}

      <div className="py-8 text-center">
        {nextToken ? (
          <button
            type="button"
            className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-ink hover:bg-slate-200 disabled:opacity-60"
            onClick={() => loadBookmarks("more")}
            disabled={loading}
          >
            {loading ? "読み込み中" : "もっと読む"}
          </button>
        ) : (
          <span className="text-sm text-quiet">{loading ? "読み込み中" : "ここまでです"}</span>
        )}
      </div>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
    </main>
  );
}
