"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookmarkTag, BookmarkTweet } from "@/lib/x-api";
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
type MenuPanel = "search" | "tag-filter" | "tag-settings";

const TAG_COLORS = ["#38bdf8", "#34d399", "#f59e0b", "#f472b6", "#a78bfa", "#f87171", "#94a3b8"];

const menuItems: { id: MenuPanel; label: string }[] = [
  { id: "search", label: "検索" },
  { id: "tag-filter", label: "タグフィルター" },
  { id: "tag-settings", label: "タグ設定" }
];

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
  const [tags, setTags] = useState<BookmarkTag[]>([]);
  const [activeMenu, setActiveMenu] = useState<MenuPanel | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTagIds, setActiveTagIds] = useState<number[]>([]);
  const [showUntaggedOnly, setShowUntaggedOnly] = useState(false);
  const [draftTagName, setDraftTagName] = useState("");
  const [draftTagColor, setDraftTagColor] = useState(TAG_COLORS[0]);
  const [tagError, setTagError] = useState<string | null>(null);
  const nextTokenRef = useRef<string | null>(null);
  const refreshDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLElement>(null);

  const clearUndoTimer = useCallback(() => {
    if (undoDoneTimerRef.current) {
      clearTimeout(undoDoneTimerRef.current);
      undoDoneTimerRef.current = null;
    }
  }, []);

  const dismissUndoNotification = useCallback(() => {
    clearUndoTimer();
    setUndoTweet(null);
  }, [clearUndoTimer]);

  const showUndoNotification = useCallback(
    (tweet: BookmarkTweet) => {
      clearUndoTimer();
      setUndoTweet(tweet);
      undoDoneTimerRef.current = setTimeout(() => {
        setUndoTweet(null);
        undoDoneTimerRef.current = null;
      }, 5000);
    },
    [clearUndoTimer]
  );

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

  const loadTags = useCallback(async () => {
    const response = await fetch("/api/tags");
    const payload = (await response.json()) as { tags?: BookmarkTag[]; error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? "TAG_FETCH_FAILED");
    }
    setTags(payload.tags ?? []);
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
        dismissUndoNotification();
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
    [dismissUndoNotification]
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
      dismissUndoNotification();
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
        await loadTags().catch(() => undefined);
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
  }, [loadBookmarks, loadTags]);

  useEffect(() => {
    return () => {
      if (refreshDoneTimerRef.current) {
        clearTimeout(refreshDoneTimerRef.current);
      }
      clearUndoTimer();
    };
  }, [clearUndoTimer]);

  useEffect(() => {
    if (!activeMenu) {
      return;
    }

    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setActiveMenu(null);
    }

    document.addEventListener("pointerdown", closeMenuOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutsideClick);
  }, [activeMenu]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuth("anonymous");
    setItems([]);
    nextTokenRef.current = null;
    setNextToken(null);
    dismissUndoNotification();
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
      showUndoNotification(tweet);
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
      dismissUndoNotification();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "BOOKMARK_OPERATION_FAILED";
      setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.BOOKMARK_OPERATION_FAILED);
    }
  }

  function getBookmarkBlockTops() {
    const articles = Array.from(listRef.current?.querySelectorAll("article") ?? []);
    return articles.map((article) => article.getBoundingClientRect().top + window.scrollY);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToAdjacentBlock(direction: "previous" | "next") {
    const tops = getBookmarkBlockTops();
    if (tops.length === 0) {
      return;
    }

    const currentTop = window.scrollY;
    const targetTop =
      direction === "previous"
        ? [...tops].reverse().find((top) => top < currentTop - 16)
        : tops.find((top) => top > currentTop + 16);

    if (targetTop !== undefined) {
      window.scrollTo({ top: targetTop, behavior: "smooth" });
    }
  }

  function applyTweetTags(tweetId: string, nextTags: BookmarkTag[]) {
    setItems((current) =>
      current.map((item) => (item.id === tweetId ? { ...item, tags: nextTags } : item))
    );
  }

  async function createNewTag() {
    const name = draftTagName.trim();
    if (!name) {
      return;
    }

    setTagError(null);
    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: draftTagColor })
      });
      const payload = (await response.json()) as { tag?: BookmarkTag; error?: string };
      if (!response.ok || !payload.tag) {
        throw new Error(payload.error ?? "TAG_CREATE_FAILED");
      }
      setTags((current) => [...current, payload.tag!].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
      setDraftTagName("");
    } catch (caught) {
      setTagError(caught instanceof Error ? caught.message : "TAG_CREATE_FAILED");
    }
  }

  async function updateExistingTag(tag: BookmarkTag, updates: Partial<BookmarkTag>) {
    setTagError(null);
    const nextTag = { ...tag, ...updates };
    setTags((current) =>
      current.map((item) => (item.id === tag.id ? nextTag : item)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    );
    setItems((current) =>
      current.map((item) => ({
        ...item,
        tags: item.tags.map((itemTag) => (itemTag.id === tag.id ? nextTag : itemTag))
      }))
    );

    try {
      const response = await fetch(`/api/tags/${tag.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      const payload = (await response.json()) as { tag?: BookmarkTag; error?: string };
      if (!response.ok || !payload.tag) {
        throw new Error(payload.error ?? "TAG_UPDATE_FAILED");
      }
      setTags((current) =>
        current.map((item) => (item.id === tag.id ? payload.tag! : item)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      );
    } catch (caught) {
      await Promise.all([loadTags().catch(() => undefined), loadBookmarks("cache").catch(() => undefined)]);
      setTagError(caught instanceof Error ? caught.message : "TAG_UPDATE_FAILED");
    }
  }

  async function deleteExistingTag(tag: BookmarkTag) {
    const ok = window.confirm(`タグ「${tag.name}」を削除しますか？このタグはすべてのポストから外れます。`);
    if (!ok) {
      return;
    }

    setTagError(null);
    setTags((current) => current.filter((item) => item.id !== tag.id));
    setItems((current) =>
      current.map((item) => ({ ...item, tags: item.tags.filter((itemTag) => itemTag.id !== tag.id) }))
    );
    setActiveTagIds((current) => current.filter((tagId) => tagId !== tag.id));

    try {
      const response = await fetch(`/api/tags/${tag.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "TAG_DELETE_FAILED");
      }
    } catch (caught) {
      await Promise.all([loadTags().catch(() => undefined), loadBookmarks("cache").catch(() => undefined)]);
      setTagError(caught instanceof Error ? caught.message : "TAG_DELETE_FAILED");
    }
  }

  async function moveTag(tag: BookmarkTag, direction: -1 | 1) {
    const ordered = [...tags].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const index = ordered.findIndex((item) => item.id === tag.id);
    const swapIndex = index + direction;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) {
      return;
    }

    const other = ordered[swapIndex];
    await updateExistingTag(tag, { sortOrder: other.sortOrder });
    await updateExistingTag(other, { sortOrder: tag.sortOrder });
  }

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (query) {
        const haystack = [
          item.text,
          item.author?.name ?? "",
          item.author?.username ?? "",
          item.note ?? "",
          ...item.tags.map((tag) => tag.name)
        ]
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      if (showUntaggedOnly && item.tags.length > 0) {
        return false;
      }

      if (activeTagIds.length > 0 && !item.tags.some((tag) => activeTagIds.includes(tag.id))) {
        return false;
      }

      return true;
    });
  }, [activeTagIds, items, searchQuery, showUntaggedOnly]);

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
        <div className="fixed bottom-6 left-1/2 z-30 flex w-[calc(100%-3rem)] max-w-[712px] -translate-x-1/2 items-center justify-between rounded-md border border-emerald-400/40 bg-emerald-950/95 p-4 text-sm text-emerald-100 shadow-lg backdrop-blur">
          <span>ブックマークを解除しました。</span>
          <button type="button" className="font-semibold underline" onClick={undoRemove}>
            元に戻す
          </button>
        </div>
      ) : null}

      <section ref={listRef} className="space-y-4">
        {filteredItems.map((tweet) => (
          <BookmarkCard
            key={tweet.id}
            tweet={tweet}
            tags={tags}
            onRemove={removeBookmark}
            onImageClick={setModalImage}
            onTagsChange={applyTweetTags}
          />
        ))}
      </section>

      {items.length > 0 && filteredItems.length === 0 && !loading ? (
        <div className="rounded-lg border border-line bg-panel p-8 text-center text-quiet">
          条件に一致するポストがありません。
        </div>
      ) : null}

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

      <div ref={menuRef} className="fixed left-4 top-3 z-40 flex flex-col items-start">
        {activeMenu ? (
          <div className="order-2 mt-3 w-[min(calc(100vw-2rem),380px)] rounded-lg border border-line bg-panel/98 p-4 text-sm text-slate-100 shadow-2xl backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-semibold">{menuItems.find((item) => item.id === activeMenu)?.label}</p>
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-xs text-slate-200 hover:bg-ink"
                onClick={() => setActiveMenu(null)}
              >
                閉じる
              </button>
            </div>

            {activeMenu === "search" ? (
              <div className="space-y-3">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
                  placeholder="本文、投稿者、メモ、タグを検索"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-sky-200 underline"
                    onClick={() => setSearchQuery("")}
                  >
                    検索をクリア
                  </button>
                ) : null}
              </div>
            ) : null}

            {activeMenu === "tag-filter" ? (
              <div className="space-y-3">
                <label
                  className={`flex items-center gap-2 rounded-md border border-dashed px-3 py-2 transition ${
                    activeTagIds.length > 0
                      ? "cursor-not-allowed border-slate-700 bg-slate-800/35 text-slate-500 opacity-60"
                      : "border-slate-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={showUntaggedOnly}
                    disabled={activeTagIds.length > 0}
                    className="disabled:cursor-not-allowed disabled:opacity-40"
                    onChange={(event) => {
                      setShowUntaggedOnly(event.target.checked);
                      if (event.target.checked) {
                        setActiveTagIds([]);
                      }
                    }}
                  />
                  <span>タグなし</span>
                </label>
                <div className="max-h-64 space-y-2 overflow-auto pr-1">
                  {tags.map((tag) => (
                    <label
                      key={tag.id}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 transition ${
                        showUntaggedOnly
                          ? "cursor-not-allowed border-slate-800 bg-slate-800/35 text-slate-500 opacity-60"
                          : "border-line"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={activeTagIds.includes(tag.id)}
                        disabled={showUntaggedOnly}
                        className="disabled:cursor-not-allowed disabled:opacity-40"
                        onChange={(event) => {
                          if (event.target.checked) {
                            setShowUntaggedOnly(false);
                          }
                          setActiveTagIds((current) =>
                            event.target.checked ? [...current, tag.id] : current.filter((tagId) => tagId !== tag.id)
                          );
                        }}
                      />
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    </label>
                  ))}
                  {tags.length === 0 ? <p className="text-quiet">タグがまだありません。</p> : null}
                </div>
                {activeTagIds.length > 0 || showUntaggedOnly ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-sky-200 underline"
                    onClick={() => {
                      setActiveTagIds([]);
                      setShowUntaggedOnly(false);
                    }}
                  >
                    フィルターをクリア
                  </button>
                ) : null}
              </div>
            ) : null}

            {activeMenu === "tag-settings" ? (
              <div className="space-y-4">
                <div className="space-y-3 rounded-md border border-line bg-ink/60 p-3">
                  <input
                    value={draftTagName}
                    onChange={(event) => setDraftTagName(event.target.value)}
                    className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
                    placeholder="新しいタグ名"
                  />
                  <div className="flex flex-wrap gap-2">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`色 ${color}`}
                        className={`h-7 w-7 rounded-full border ${draftTagColor === color ? "border-white" : "border-transparent"}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setDraftTagColor(color)}
                      />
                    ))}
                    <label className="ml-1 flex h-7 items-center gap-2 rounded-md border border-line bg-panel px-2 text-xs text-slate-300">
                      <span>任意</span>
                      <input
                        type="color"
                        value={draftTagColor}
                        onChange={(event) => setDraftTagColor(event.target.value)}
                        className="h-5 w-8 cursor-pointer border-0 bg-transparent p-0"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-200 disabled:opacity-50"
                    onClick={createNewTag}
                    disabled={!draftTagName.trim()}
                  >
                    追加
                  </button>
                </div>

                <div className="max-h-72 space-y-2 overflow-auto pr-1">
                  {tags.map((tag, index) => (
                    <div key={tag.id} className="rounded-md border border-line p-3">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                        <input
                          defaultValue={tag.name}
                          onBlur={(event) => {
                            if (event.target.value !== tag.name) {
                              void updateExistingTag(tag, { name: event.target.value });
                            }
                          }}
                          className="min-w-0 flex-1 rounded-md border border-line bg-ink px-2 py-1 text-sm text-slate-100 outline-none focus:border-slate-500"
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {TAG_COLORS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label={`色 ${color}`}
                            className={`h-5 w-5 rounded-full border ${tag.color === color ? "border-white" : "border-transparent"}`}
                            style={{ backgroundColor: color }}
                            onClick={() => updateExistingTag(tag, { color })}
                          />
                        ))}
                        <label className="flex h-6 items-center gap-1 rounded border border-line bg-ink px-1.5 text-xs text-slate-300">
                          <span>任意</span>
                          <input
                            type="color"
                            value={tag.color}
                            onChange={(event) => updateExistingTag(tag, { color: event.target.value })}
                            className="h-4 w-7 cursor-pointer border-0 bg-transparent p-0"
                          />
                        </label>
                        <button
                          type="button"
                          className="ml-auto rounded border border-line px-2 py-1 text-xs disabled:opacity-40"
                          onClick={() => moveTag(tag, -1)}
                          disabled={index === 0}
                        >
                          上へ
                        </button>
                        <button
                          type="button"
                          className="rounded border border-line px-2 py-1 text-xs disabled:opacity-40"
                          onClick={() => moveTag(tag, 1)}
                          disabled={index === tags.length - 1}
                        >
                          下へ
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-400/50 px-2 py-1 text-xs text-red-100"
                          onClick={() => deleteExistingTag(tag)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))}
                  {tags.length === 0 ? <p className="text-quiet">タグがまだありません。</p> : null}
                </div>
                {tagError ? <p className="text-xs text-red-200">{tagError}</p> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="order-1 flex items-start gap-2">
          <button
            type="button"
            aria-label="メニュー"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white text-2xl font-semibold leading-none text-ink shadow-lg transition hover:bg-slate-200"
            onClick={() => setActiveMenu((current) => (current ? null : "search"))}
          >
            ≡
          </button>
          {activeMenu ? (
            <div className="flex flex-row flex-wrap gap-2">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-md border px-3 py-2 text-left text-sm font-semibold shadow-lg ${
                    activeMenu === item.id
                      ? "border-white bg-white text-ink"
                      : "border-line bg-panel text-slate-100 hover:bg-ink"
                  }`}
                  onClick={() => setActiveMenu(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="fixed bottom-6 left-6 z-40 flex flex-col gap-2">
        <button
          type="button"
          aria-label="一番上まで飛ぶ"
          title="一番上まで飛ぶ"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-panel/95 shadow-lg backdrop-blur transition hover:bg-ink"
          onClick={scrollToTop}
        >
          <img src="/icons/nav-top.svg" alt="" className="h-6 w-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="ひとつ上のブロックへ"
          title="ひとつ上のブロックへ"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-panel/95 shadow-lg backdrop-blur transition hover:bg-ink"
          onClick={() => scrollToAdjacentBlock("previous")}
        >
          <img src="/icons/nav-previous.svg" alt="" className="h-6 w-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="ひとつ下のブロックへ"
          title="ひとつ下のブロックへ"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-panel/95 shadow-lg backdrop-blur transition hover:bg-ink"
          onClick={() => scrollToAdjacentBlock("next")}
        >
          <img src="/icons/nav-next.svg" alt="" className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <ImageModal image={modalImage} onClose={() => setModalImage(null)} />
    </main>
  );
}
