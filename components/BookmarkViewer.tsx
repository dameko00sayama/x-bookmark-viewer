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
  error?: string;
};

type AuthState = "checking" | "anonymous" | "authenticated";

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "認証が切れています。再ログインしてください。",
  BILLING_REQUIRED:
    "X APIが402を返しました。Developer PortalでAPIアクセスプラン、支払い設定、対象Appの権限を確認してください。",
  RATE_LIMITED: "X APIの制限に達しました。しばらく待ってから更新してください。",
  X_API_FAILED: "X APIの取得に失敗しました。",
  BOOKMARK_FETCH_FAILED: "ブックマークの取得に失敗しました。",
  BOOKMARK_OPERATION_FAILED: "ブックマーク操作に失敗しました。",
  oauth_state: "OAuth認証を安全に完了できませんでした。もう一度ログインしてください。",
  oauth_failed: "X OAuth認証に失敗しました。設定を確認して再ログインしてください。",
  missing_config: ".env の X_CLIENT_ID が未設定です。設定後に docker-compose up -d --build で再起動してください。"
};

export default function BookmarkViewer() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [items, setItems] = useState<BookmarkTweet[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalImage, setModalImage] = useState<{ url: string; altText: string | null } | null>(null);
  const [undoTweet, setUndoTweet] = useState<BookmarkTweet | null>(null);
  const nextTokenRef = useRef<string | null>(null);

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
    async (mode: "refresh" | "more") => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (mode === "more" && nextTokenRef.current) {
        params.set("pagination_token", nextTokenRef.current);
      }

      try {
        const response = await fetch(`/api/bookmarks${params.size ? `?${params}` : ""}`);
        const payload = (await response.json()) as BookmarkResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "BOOKMARK_FETCH_FAILED");
        }

        setItems((current) => (mode === "refresh" ? payload.items : [...current, ...payload.items]));
        nextTokenRef.current = payload.nextToken;
        setNextToken(payload.nextToken);
        setUndoTweet(null);
      } catch (caught) {
        const code = caught instanceof Error ? caught.message : "BOOKMARK_FETCH_FAILED";
        setError(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.BOOKMARK_FETCH_FAILED);
        if (code === "AUTH_REQUIRED") {
          setAuth("anonymous");
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

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
        await loadBookmarks("refresh");
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

  return (
    <main className="mx-auto min-h-screen w-full max-w-[760px] px-6 py-8">
      <header className="sticky top-0 z-20 -mx-6 mb-6 border-b border-line bg-ink/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[760px] items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">X Bookmark Viewer</h1>
            <p className="text-sm text-quiet">ブックマーク専用</p>
            <p className="text-xs text-slate-400">v{version}</p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-panel"
              onClick={() => loadBookmarks("refresh")}
              disabled={loading}
            >
              更新
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
      </header>

      {error ? (
        <div className="mb-5 rounded-md border border-red-400/40 bg-red-950/40 p-4 text-sm text-red-100">
          {error}
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
