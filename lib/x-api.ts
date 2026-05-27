import { createHash } from "crypto";
import { getAuth, saveAuth, type StoredAuth } from "./db";

export type BookmarkMedia = {
  key: string;
  type: string;
  url: string;
  altText: string | null;
};

export type BookmarkAuthor = {
  id: string;
  name: string;
  username: string;
};

export type BookmarkTweet = {
  id: string;
  text: string;
  createdAt: string | null;
  author: BookmarkAuthor | null;
  media: BookmarkMedia[];
  quotedTweet: Omit<BookmarkTweet, "media" | "quotedTweet"> | null;
};

export type BookmarkPage = {
  items: BookmarkTweet[];
  nextToken: string | null;
};

type TokenResponse = {
  token_type: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

const X_API_BASE = "https://api.x.com";
const SCOPES = ["tweet.read", "users.read", "bookmark.read", "bookmark.write", "offline.access"];
const BOOKMARK_TWEET_FIELDS = [
  "attachments",
  "author_id",
  "created_at",
  "referenced_tweets",
  "text",
  "note_tweet"
].join(",");
const FULL_TWEET_FIELDS = [
  "attachments",
  "author_id",
  "created_at",
  "referenced_tweets",
  "text",
  "entities",
  "conversation_id",
  "note_tweet"
].join(",");

export function getScopes() {
  return SCOPES.join(" ");
}

export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function createCodeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function getBaseUrl(defaultBaseUrl?: string) {
  return process.env.APP_BASE_URL ?? defaultBaseUrl ?? "http://localhost:8080";
}

function getCallbackUrl(defaultBaseUrl?: string) {
  return process.env.X_CALLBACK_URL ?? `${getBaseUrl(defaultBaseUrl)}/api/auth/callback/x`;
}

function getTokenHeaders() {
  const headers: HeadersInit = {
    "Content-Type": "application/x-www-form-urlencoded"
  };
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (clientSecret) {
    const credentials = Buffer.from(`${getRequiredEnv("X_CLIENT_ID")}:${clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  }

  return headers;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  if (!process.env.X_CLIENT_SECRET) {
    body.set("client_id", getRequiredEnv("X_CLIENT_ID"));
  }

  const response = await fetch(`${X_API_BASE}/2/oauth2/token`, {
    method: "POST",
    headers: getTokenHeaders(),
    body
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => null);
    throw new Error(
      `X OAuth token request failed: ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  return response.json();
}

export function buildAuthorizationUrl(state: string, codeChallenge: string, defaultBaseUrl?: string) {
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", getRequiredEnv("X_CLIENT_ID"));
  url.searchParams.set("redirect_uri", getCallbackUrl(defaultBaseUrl));
  url.searchParams.set("scope", getScopes());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export async function exchangeCodeForToken(code: string, verifier: string) {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getCallbackUrl(),
      code_verifier: verifier
    })
  );
}

async function refreshAuth(auth: StoredAuth): Promise<StoredAuth> {
  if (!auth.refreshToken) {
    throw new Error("refresh_token is missing");
  }

  const token = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken
    })
  );

  const refreshed = {
    userId: auth.userId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + (token.expires_in ?? 7200) * 1000
  };

  saveAuth(refreshed);
  return refreshed;
}

export async function getValidAuth(): Promise<StoredAuth> {
  const auth = getAuth();
  if (!auth) {
    throw new AuthRequiredError();
  }

  if (auth.expiresAt - Date.now() < 60_000) {
    return refreshAuth(auth);
  }

  return auth;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication is required");
    this.name = "AuthRequiredError";
  }
}

export class XApiError extends Error {
  status: number;
  detail: string | null;

  constructor(status: number, message: string, detail: string | null = null) {
    super(message);
    this.name = "XApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function xFetch(path: string, init: RequestInit = {}) {
  const auth = await getValidAuth();
  const response = await fetch(`${X_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...(init.headers ?? {})
    }
  });

  if (response.status === 401 || response.status === 403) {
    throw new AuthRequiredError();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => null);
    throw new XApiError(response.status, `X API request failed: ${response.status}`, detail);
  }

  return response;
}

const X_WEB_BASE = "https://x.com";

async function fetchTweetTextFromWeb(tweetId: string): Promise<string | null> {
  const response = await fetch(`${X_WEB_BASE}/i/web/status/${tweetId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const marker = "window.__INITIAL_STATE__=";
  const start = html.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const end = html.indexOf("</script>", start);
  if (end === -1) {
    return null;
  }

  const jsonText = html.slice(start + marker.length, end);
  let state: any;
  try {
    state = JSON.parse(jsonText);
  } catch {
    return null;
  }

  const tweetData = state?.entities?.tweets?.entities?.[tweetId];
  if (!tweetData) {
    return null;
  }

  const text = tweetData.full_text ?? tweetData.text;
  if (typeof text !== "string") {
    return null;
  }

  return text.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, "");
}

export async function fetchMe(accessToken: string): Promise<{ id: string; name: string; username: string }> {
  const response = await fetch(`${X_API_BASE}/2/users/me?user.fields=username,name`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => null);
    throw new Error(
      `X user request failed: ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  const payload = await response.json();
  return payload.data;
}

export async function fetchBookmarks(paginationToken?: string | null): Promise<BookmarkPage> {
  const auth = await getValidAuth();
  const url = new URL(`${X_API_BASE}/2/users/${auth.userId}/bookmarks`);
  url.searchParams.set("max_results", "50");
  url.searchParams.set("tweet.fields", BOOKMARK_TWEET_FIELDS);
  url.searchParams.set("user.fields", "name,username");
  url.searchParams.set("media.fields", "alt_text,preview_image_url,type,url");
  url.searchParams.set("expansions", "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id");

  if (paginationToken) {
    url.searchParams.set("pagination_token", paginationToken);
  }

  const response = await xFetch(`${url.pathname}${url.search}`);
  const payload = await response.json();

  return normalizeBookmarks(payload);
}

export async function fetchTweet(tweetId: string, expandThread = false): Promise<BookmarkTweet> {
  const auth = await getValidAuth();
  const url = new URL(`${X_API_BASE}/2/tweets/${tweetId}`);
  url.searchParams.set("tweet.fields", FULL_TWEET_FIELDS);
  url.searchParams.set("user.fields", "name,username");
  url.searchParams.set("media.fields", "alt_text,preview_image_url,type,url");
  url.searchParams.set(
    "expansions",
    "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id"
  );

  const response = await xFetch(`${url.pathname}${url.search}`);
  const payload = await response.json();

  // normalize initial tweet
  const norm = normalizeBookmarks({ data: [payload.data], includes: payload.includes ?? {} });
  let tweet = norm.items[0];

  if (tweet && tweet.text.length >= 140) {
    const webText = await fetchTweetTextFromWeb(tweet.id).catch(() => null);
    if (webText && webText.length > tweet.text.length) {
      tweet.text = webText;
    }
  }

  // If requested, try to expand thread by fetching other tweets in the same conversation
  if (expandThread && tweet?.createdAt && payload.data?.conversation_id) {
    try {
      const convId = payload.data.conversation_id;
      const authorId = payload.data.author_id;
      const sUrl = new URL(`${X_API_BASE}/2/tweets/search/recent`);
      // search for other tweets in the same conversation by the same author
      sUrl.searchParams.set("query", `conversation_id:${convId} author_id:${authorId}`);
      sUrl.searchParams.set("max_results", "100");
      sUrl.searchParams.set("tweet.fields", FULL_TWEET_FIELDS);
      sUrl.searchParams.set("expansions", "author_id,attachments.media_keys");
      sUrl.searchParams.set("user.fields", "name,username");
      sUrl.searchParams.set("media.fields", "alt_text,preview_image_url,type,url");

      const sResp = await xFetch(`${sUrl.pathname}${sUrl.search}`);
      const sPayload = await sResp.json();

      // collect tweets from data + includes.tweets
      const tweets: any[] = [];
      if (sPayload.data) {
        tweets.push(...(Array.isArray(sPayload.data) ? sPayload.data : [sPayload.data]));
      }
      if (sPayload.includes?.tweets) {
        tweets.push(...sPayload.includes.tweets);
      }

      // keep only those by the same author and sort by created_at
      const sameAuthor = tweets
        .filter((t) => t.author_id === authorId)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (sameAuthor.length > 0) {
        // assemble full text by joining texts (ensure original tweet first)
        // If original tweet is included twice, dedupe by id
        const ids = new Set<string>();
        const orderedParts: string[] = [];
        for (const t of sameAuthor) {
          if (!ids.has(t.id)) {
            ids.add(t.id);
            orderedParts.push(getTweetText(t));
          }
        }
        tweet.text = orderedParts.join("\n\n");

        // merge media from includes if present
        const mediaMap = new Map<string, any>();
        for (const m of sPayload.includes?.media ?? []) {
          const url = m.url ?? m.preview_image_url;
          if (url) {
            mediaMap.set(m.media_key, { key: m.media_key, type: m.type, url, altText: m.alt_text ?? null });
          }
        }

        const mediaKeys = sameAuthor.flatMap((t) => t.attachments?.media_keys ?? []);
        tweet.media = mediaKeys.map((k: string) => mediaMap.get(k)).filter(Boolean);
      }
    } catch (e) {
      // best-effort; ignore errors while expanding thread
    }
  }

  return tweet;
}

export async function removeBookmark(tweetId: string) {
  const auth = await getValidAuth();
  await xFetch(`/2/users/${auth.userId}/bookmarks/${tweetId}`, {
    method: "DELETE"
  });
}

export async function addBookmark(tweetId: string) {
  const auth = await getValidAuth();
  await xFetch(`/2/users/${auth.userId}/bookmarks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ tweet_id: tweetId })
  });
}

function getTweetText(tweet: any): string {
  return tweet.note_tweet?.text ?? tweet.text ?? "";
}

function normalizeBookmarks(payload: any): BookmarkPage {
  const users = new Map<string, BookmarkAuthor>();
  const tweets = new Map<string, any>();
  const media = new Map<string, BookmarkMedia>();

  for (const user of payload.includes?.users ?? []) {
    users.set(user.id, { id: user.id, name: user.name, username: user.username });
  }

  for (const tweet of [...(payload.data ?? []), ...(payload.includes?.tweets ?? [])]) {
    tweets.set(tweet.id, tweet);
  }

  for (const item of payload.includes?.media ?? []) {
    const url = item.url ?? item.preview_image_url;
    if (url) {
      media.set(item.media_key, {
        key: item.media_key,
        type: item.type,
        url,
        altText: item.alt_text ?? null
      });
    }
  }

  const toTweet = (tweet: any): BookmarkTweet => {
    const mediaKeys = tweet.attachments?.media_keys ?? [];
    const quotedRef = (tweet.referenced_tweets ?? []).find((ref: any) => ref.type === "quoted");
    const quoted = quotedRef ? tweets.get(quotedRef.id) : null;

    return {
      id: tweet.id,
      text: getTweetText(tweet),
      createdAt: tweet.created_at ?? null,
      author: tweet.author_id ? users.get(tweet.author_id) ?? null : null,
      media: mediaKeys.map((key: string) => media.get(key)).filter(Boolean),
      quotedTweet: quoted
        ? {
            id: quoted.id,
            text: getTweetText(quoted),
            createdAt: quoted.created_at ?? null,
            author: quoted.author_id ? users.get(quoted.author_id) ?? null : null
          }
        : null
    };
  };

  return {
    items: (payload.data ?? []).map(toTweet),
    nextToken: payload.meta?.next_token ?? null
  };
}
