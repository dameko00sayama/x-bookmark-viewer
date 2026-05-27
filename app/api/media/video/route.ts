import { NextRequest } from "next/server";

const ALLOWED_VIDEO_HOSTS = new Set(["video.twimg.com", "pbs.twimg.com"]);

function parseVideoUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !ALLOWED_VIDEO_HOSTS.has(url.hostname)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const sourceUrl = parseVideoUrl(request.nextUrl.searchParams.get("url"));
  if (!sourceUrl) {
    return new Response("Invalid video URL", { status: 400 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(sourceUrl, {
    headers: {
      Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
      ...(range ? { Range: range } : {})
    }
  });

  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Video fetch failed", { status: upstream.status });
  }

  const headers = new Headers();
  const passthroughHeaders = [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified"
  ];

  for (const name of passthroughHeaders) {
    const value = upstream.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  headers.set("Cache-Control", "private, max-age=3600");

  return new Response(upstream.body, {
    status: upstream.status,
    headers
  });
}
