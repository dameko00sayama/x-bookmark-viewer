"use client";

import type { BookmarkTweet } from "@/lib/x-api";
import { useState } from "react";

type BookmarkCardProps = {
  tweet: BookmarkTweet;
  onRemove: (tweet: BookmarkTweet) => void;
  onImageClick: (image: { url: string; altText: string | null }) => void;
};

function formatDate(value: string | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function tweetUrl(tweet: BookmarkTweet | Omit<BookmarkTweet, "media" | "quotedTweet">) {
  const username = tweet.author?.username ?? "i";
  return `https://x.com/${username}/status/${tweet.id}`;
}

export default function BookmarkCard({ tweet, onRemove, onImageClick }: BookmarkCardProps) {
  const [localTweet, setLocalTweet] = useState<BookmarkTweet>(tweet);
  const [trans, setTrans] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loadingFull, setLoadingFull] = useState(false);
  function isProbablyTruncated(text: string) {
    const t = (text ?? "").trim();
    if (t.length > 140) return true;
    if (t.endsWith("…") || t.endsWith("...")) return true;
    if (t.includes("…") && t.length > 100) return true;
    return false;
  }
  const openTweet = () => {
    window.open(tweetUrl(localTweet), "_blank", "noopener,noreferrer");
  };
  const isTruncated = isProbablyTruncated(localTweet.text);
  const previewText = isTruncated ? `${localTweet.text.slice(0, 140)}...` : localTweet.text;

  async function loadFull(expandThread = false) {
    try {
      setLoadingFull(true);
      const params = expandThread ? "?expand=thread" : "";
      const resp = await fetch(`/api/tweets/${localTweet.id}${params}`);
      if (!resp.ok) {
        return;
      }
      const payload = await resp.json();
      setLocalTweet(payload);
    } finally {
      setLoadingFull(false);
    }
  }

  async function translate() {
    try {
      setTrans("翻訳中...");
      const resp = await fetch(`/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: localTweet.text, target: "ja" })
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setTrans(body?.error ?? "翻訳に失敗しました");
        return;
      }
      const payload = await resp.json();
      setTrans(payload.translatedText ?? payload.translated_text ?? "");
    } catch (e) {
      setTrans("翻訳に失敗しました");
    }
  }

  return (
    <article
      className="rounded-lg border border-line bg-panel p-5 transition hover:border-slate-500"
      onClick={openTweet}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-white">{tweet.author?.name ?? "Unknown"}</div>
          <div className="text-sm text-quiet">@{tweet.author?.username ?? tweet.author?.id ?? "unknown"}</div>
        </div>
        <time className="shrink-0 text-sm text-quiet">{formatDate(tweet.createdAt)}</time>
      </div>

      <div className="flex flex-col gap-2" onClick={(event) => event.stopPropagation()}>
        <p className="whitespace-pre-wrap leading-7 text-slate-100">
          {expanded ? localTweet.text : previewText}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="text-sm font-semibold text-slate-300 underline"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((current) => !current);
            }}
          >
            {expanded ? "閉じる" : isTruncated ? "続きを読む" : "開く"}
          </button>
          {expanded ? (
            <>
            <button
              type="button"
              className="text-sm text-slate-300 underline"
              onClick={(e) => {
                e.stopPropagation();
                loadFull();
              }}
              disabled={loadingFull}
            >
              {loadingFull ? "取得中..." : "全文取得"}
            </button>
            <button
              type="button"
              className="text-sm text-slate-300 underline"
              onClick={(e) => {
                e.stopPropagation();
                loadFull(true);
              }}
              disabled={loadingFull}
            >
              スレッド取得
            </button>
            <button
              type="button"
              className="text-sm text-slate-300 underline"
              onClick={(e) => {
                e.stopPropagation();
                translate();
              }}
            >
              翻訳
            </button>
            </>
          ) : null}
        </div>
        {expanded && trans ? <div className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{trans}</div> : null}
      </div>

      {localTweet.media.length > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-3" onClick={(event) => event.stopPropagation()}>
          {localTweet.media.map((image) => (
            <button
              key={image.key}
              type="button"
              className="overflow-hidden rounded-md border border-line bg-black"
              onClick={() => onImageClick({ url: image.url, altText: image.altText })}
            >
              <img src={image.url} alt={image.altText ?? ""} className="h-48 w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}

      {localTweet.quotedTweet ? (
        <button
          type="button"
          className="mt-4 w-full rounded-md border border-line bg-ink p-4 text-left transition hover:border-slate-500"
          onClick={(event) => {
            event.stopPropagation();
            window.open(tweetUrl(localTweet.quotedTweet!), "_blank", "noopener,noreferrer");
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-3 text-sm text-quiet">
            <span>
              {localTweet.quotedTweet.author?.name ?? "Unknown"} @{localTweet.quotedTweet.author?.username ?? "unknown"}
            </span>
            <span>{formatDate(localTweet.quotedTweet.createdAt)}</span>
          </div>
          <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-200">
            {localTweet.quotedTweet.text}
          </p>
        </button>
      ) : null}

      <div className="mt-5 flex justify-end" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="rounded-md border border-red-400/50 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-950/50"
          onClick={() => onRemove(tweet)}
        >
          ブックマーク解除
        </button>
      </div>
    </article>
  );
}
