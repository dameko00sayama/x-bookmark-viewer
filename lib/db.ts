import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { decryptText, encryptText } from "./crypto";
import type { BookmarkTweet } from "./x-api";

export type StoredAuth = {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};

export type StoredOAuthState = {
  state: string;
  verifier: string;
  expiresAt: number;
};

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "app.sqlite");

let db: Database.Database | null = null;

function getDb() {
  if (!db) {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        verifier TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cached_bookmark_tweets (
        tweet_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        cached_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at INTEGER NOT NULL,
        operation TEXT NOT NULL,
        resources INTEGER NOT NULL,
        estimated_cost_usd REAL NOT NULL
      );
    `);
  }

  return db;
}

export function saveAuth(auth: StoredAuth) {
  getDb()
    .prepare(
      `
      INSERT INTO auth (id, user_id, access_token, refresh_token, expires_at, updated_at)
      VALUES ('default', @userId, @accessToken, @refreshToken, @expiresAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `
    )
    .run({
      userId: auth.userId,
      accessToken: encryptText(auth.accessToken),
      refreshToken: auth.refreshToken ? encryptText(auth.refreshToken) : null,
      expiresAt: auth.expiresAt,
      updatedAt: Date.now()
    });
}

export function getAuth(): StoredAuth | null {
  const row = getDb()
    .prepare("SELECT user_id, access_token, refresh_token, expires_at FROM auth WHERE id = 'default'")
    .get() as
    | {
        user_id: string;
        access_token: string;
        refresh_token: string | null;
        expires_at: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    accessToken: decryptText(row.access_token),
    refreshToken: row.refresh_token ? decryptText(row.refresh_token) : null,
    expiresAt: row.expires_at
  };
}

export function clearAuth() {
  getDb().prepare("DELETE FROM auth WHERE id = 'default'").run();
}

export function saveOAuthState(state: string, verifier: string) {
  const now = Date.now();
  getDb().prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(now);
  getDb()
    .prepare(
      `
      INSERT INTO oauth_states (state, verifier, expires_at, created_at)
      VALUES (@state, @verifier, @expiresAt, @createdAt)
    `
    )
    .run({
      state,
      verifier: encryptText(verifier),
      expiresAt: now + 10 * 60 * 1000,
      createdAt: now
    });
}

export function consumeOAuthState(state: string): StoredOAuthState | null {
  const row = getDb()
    .prepare("SELECT state, verifier, expires_at FROM oauth_states WHERE state = ?")
    .get(state) as { state: string; verifier: string; expires_at: number } | undefined;

  getDb().prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

  if (!row || row.expires_at < Date.now()) {
    return null;
  }

  return {
    state: row.state,
    verifier: decryptText(row.verifier),
    expiresAt: row.expires_at
  };
}

export type CachedBookmarkPage = {
  items: BookmarkTweet[];
  nextToken: string | null;
};

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null) {
  if (value === null) {
    getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
    return;
  }

  getDb()
    .prepare(
      `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
    )
    .run(key, value, Date.now());
}

export function getCachedBookmarkCount() {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM cached_bookmark_tweets")
    .get() as { count: number };
  return row.count;
}

export function getCachedBookmarkPage(offset = 0, limit = 50): CachedBookmarkPage {
  const rows = getDb()
    .prepare(
      `
      SELECT payload
      FROM cached_bookmark_tweets
      ORDER BY sort_order ASC, cached_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(limit, offset) as { payload: string }[];

  const total = getCachedBookmarkCount();

  return {
    items: rows.map((row) => JSON.parse(row.payload) as BookmarkTweet),
    nextToken: offset + rows.length < total ? `cache:${offset + rows.length}` : null
  };
}

export function saveCachedBookmarkPage(items: BookmarkTweet[], offset: number, nextXToken: string | null) {
  const now = Date.now();
  const db = getDb();

  db.transaction(() => {
    if (offset === 0 && items.length > 0) {
      db.prepare("UPDATE cached_bookmark_tweets SET sort_order = sort_order + ?").run(items.length);
    }

    const statement = db.prepare(
      `
      INSERT INTO cached_bookmark_tweets (tweet_id, payload, sort_order, cached_at, updated_at)
      VALUES (@tweetId, @payload, @sortOrder, @cachedAt, @updatedAt)
      ON CONFLICT(tweet_id) DO UPDATE SET
        payload = excluded.payload,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `
    );

    items.forEach((item, index) => {
      statement.run({
        tweetId: item.id,
        payload: JSON.stringify(item),
        sortOrder: offset + index,
        cachedAt: now,
        updatedAt: now
      });
    });

    setSetting("bookmarks_next_x_token", nextXToken);
  })();
}

export function saveCachedTweet(tweet: BookmarkTweet) {
  const now = Date.now();
  getDb()
    .prepare(
      `
      INSERT INTO cached_bookmark_tweets (tweet_id, payload, sort_order, cached_at, updated_at)
      VALUES (@tweetId, @payload, COALESCE((SELECT sort_order FROM cached_bookmark_tweets WHERE tweet_id = @tweetId), 0), @cachedAt, @updatedAt)
      ON CONFLICT(tweet_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `
    )
    .run({
      tweetId: tweet.id,
      payload: JSON.stringify(tweet),
      cachedAt: now,
      updatedAt: now
    });
}

export function recordApiUsage(operation: string, resources: number, estimatedCostUsd: number) {
  getDb()
    .prepare(
      `
      INSERT INTO api_usage (occurred_at, operation, resources, estimated_cost_usd)
      VALUES (?, ?, ?, ?)
    `
    )
    .run(Date.now(), operation, resources, estimatedCostUsd);
}

export function getMonthlyEstimatedApiCost(now = Date.now()) {
  const date = new Date(now);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost FROM api_usage WHERE occurred_at >= ?")
    .get(start) as { cost: number };
  return row.cost;
}
