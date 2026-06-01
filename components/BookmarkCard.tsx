"use client";

import type { BookmarkTweet } from "@/lib/x-api";
import { useRef, useState } from "react";

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

function formatFetchedAt(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function tweetUrl(tweet: Pick<BookmarkTweet, "id" | "author">) {
  const username = tweet.author?.username ?? "i";
  return `https://x.com/${username}/status/${tweet.id}`;
}

function linkedText(text: string) {
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(urlPattern)) {
    const url = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    nodes.push(
      <a
        key={`${url}-${index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-sky-300 underline decoration-sky-300/60 underline-offset-2 hover:text-sky-200"
        onClick={(event) => event.stopPropagation()}
      >
        {url}
      </a>
    );

    lastIndex = index + url.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function firstLine(text: string) {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

type VideoMediaProps = {
  media: BookmarkTweet["media"][number];
};

function proxiedVideoUrl(url: string | null) {
  return url ? `/api/media/video?url=${encodeURIComponent(url)}` : undefined;
}

function VideoMedia({ media }: VideoMediaProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);

  async function playVideo(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPlayError(false);

    try {
      await videoRef.current?.play();
    } catch {
      setPlayError(true);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-black" onClick={(event) => event.stopPropagation()}>
      <video
        ref={videoRef}
        src={proxiedVideoUrl(media.videoUrl)}
        poster={media.url}
        controls
        playsInline
        preload="metadata"
        loop={media.type === "animated_gif"}
        muted={media.type === "animated_gif"}
        className="h-48 w-full object-contain"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onPlay={() => {
          setIsPlaying(true);
          setPlayError(false);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      {!isPlaying ? (
        <button
          type="button"
          aria-label="動画を再生"
          className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition hover:bg-black/10"
          onClick={playVideo}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 pl-1 text-3xl shadow-lg ring-1 ring-white/25">
            ▶
          </span>
        </button>
      ) : null}
      {playError ? (
        <div className="absolute bottom-2 left-2 right-2 rounded bg-black/80 px-2 py-1 text-xs text-slate-100">
          ブラウザで再生できません。右下のメニューから開くか、ポストを開いて確認してください。
        </div>
      ) : null}
    </div>
  );
}

export default function BookmarkCard({ tweet, onRemove, onImageClick }: BookmarkCardProps) {
  const [localTweet, setLocalTweet] = useState<BookmarkTweet>(tweet);
  const [trans, setTrans] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(tweet.collapsed);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(tweet.note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
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
  const fetchedAt = formatFetchedAt(localTweet.cachedAt);

  async function loadFull(expandThread = false) {
    try {
      setLoadingFull(true);
      const params = expandThread ? "?expand=thread" : "";
      const resp = await fetch(`/api/tweets/${localTweet.id}${params}`);
      if (!resp.ok) {
        return;
      }
      const payload = await resp.json();
      setLocalTweet((current) => ({ ...payload, note: current.note, collapsed: current.collapsed }));
    } finally {
      setLoadingFull(false);
    }
  }

  async function saveCollapsed(nextCollapsed: boolean) {
    const previous = collapsed;
    setCollapsed(nextCollapsed);
    setExpanded(false);
    setNoteOpen(false);
    setLocalTweet((current) => ({ ...current, collapsed: nextCollapsed }));

    try {
      const response = await fetch(`/api/bookmarks/${localTweet.id}/collapsed`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collapsed: nextCollapsed })
      });
      if (!response.ok) {
        throw new Error("COLLAPSE_SAVE_FAILED");
      }
    } catch {
      setCollapsed(previous);
      setLocalTweet((current) => ({ ...current, collapsed: previous }));
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
        setTrans(
          body?.error === "EXTERNAL_TRANSLATION_DISABLED"
            ? "外部翻訳は無効です。使う場合は ENABLE_EXTERNAL_TRANSLATION=1 を設定してください。"
            : body?.error ?? "翻訳に失敗しました"
        );
        return;
      }
      const payload = await resp.json();
      setTrans(payload.translatedText ?? payload.translated_text ?? "");
    } catch (e) {
      setTrans("翻訳に失敗しました");
    }
  }

  async function saveNote() {
    try {
      setSavingNote(true);
      setNoteError(null);
      const response = await fetch(`/api/bookmarks/${localTweet.id}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note })
      });
      if (!response.ok) {
        setNoteError("繝｡繝｢縺ｮ菫晏ｭ倥↓螟ｱ謨励＠縺ｾ縺励◆");
      }
    } finally {
      setSavingNote(false);
    }
  }

  if (collapsed) {
    return (
      <article className="rounded-lg border border-slate-800/70 bg-slate-900/45 px-5 py-4 opacity-85 transition hover:border-slate-600 hover:opacity-100">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-300">
              {localTweet.author?.name ?? "Unknown"}{" "}
              <span className="whitespace-nowrap text-slate-500">
                (@{localTweet.author?.username ?? localTweet.author?.id ?? "unknown"})
              </span>
            </div>
            <p className="mt-2 line-clamp-1 text-sm leading-6 text-slate-400">
              {firstLine(localTweet.text) || "本文なし"}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 hover:text-slate-100"
            onClick={() => saveCollapsed(false)}
          >
            開く
          </button>
        </div>
      </article>
    );
  }

  return (
    <article
      className="rounded-lg border border-line bg-panel p-5 transition hover:border-slate-500"
      onClick={openTweet}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">
            <span className="group cursor-pointer break-words transition hover:text-sky-300 hover:underline hover:decoration-sky-300/70 hover:underline-offset-2">
              {tweet.author?.name ?? "Unknown"}{" "}
              <span className="whitespace-nowrap text-quiet transition group-hover:text-sky-300">
                (@{tweet.author?.username ?? tweet.author?.id ?? "unknown"})
              </span>
            </span>
          </div>
        </div>
        <time className="shrink-0 cursor-pointer text-sm text-quiet transition hover:text-sky-300 hover:underline hover:decoration-sky-300/70 hover:underline-offset-2">
          {formatDate(tweet.createdAt)}
        </time>
      </div>

      <div className="flex flex-col gap-2" onClick={(event) => event.stopPropagation()}>
        <p className="whitespace-pre-wrap leading-7 text-slate-100">
          {linkedText(expanded ? localTweet.text : previewText)}
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
          {localTweet.media.map((image) =>
            image.videoUrl ? (
              <VideoMedia key={image.key} media={image} />
            ) : (
              <button
                key={image.key}
                type="button"
                className="overflow-hidden rounded-md border border-line bg-black"
                onClick={() => onImageClick({ url: image.url, altText: image.altText })}
              >
                <img src={image.url} alt={image.altText ?? ""} className="h-48 w-full object-cover" />
              </button>
            )
          )}
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

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3" onClick={(event) => event.stopPropagation()}>
        {fetchedAt ? <p className="mr-auto text-xs text-slate-500">取得: {fetchedAt}</p> : null}
        <button
          type="button"
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-ink"
          onClick={() => saveCollapsed(true)}
        >
          畳む
        </button>
        <button
          type="button"
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-ink"
          onClick={() => setNoteOpen((current) => !current)}
        >
          {noteOpen ? "メモを閉じる" : note.trim() ? "メモあり" : "メモ"}
        </button>
        <button
          type="button"
          className="rounded-md border border-red-400/50 px-4 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-950/50"
          onClick={() => onRemove(tweet)}
        >
          ブックマーク解除
        </button>
      </div>
      {noteOpen ? (
        <div className="mt-3" onClick={(event) => event.stopPropagation()}>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={saveNote}
            rows={4}
            className="w-full resize-y rounded-md border border-line bg-ink p-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-quiet focus:border-slate-500"
            placeholder="このポストについてのローカルメモ"
          />
          <div className="mt-2 flex justify-end">
            {noteError ? <p className="mr-auto text-sm text-red-200">{noteError}</p> : null}
            <button
              type="button"
              className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-slate-100 transition hover:bg-ink disabled:opacity-60"
              onClick={saveNote}
              disabled={savingNote}
            >
              {savingNote ? "保存中" : "保存"}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
