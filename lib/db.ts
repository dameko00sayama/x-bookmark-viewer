import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { decryptText, encryptText } from "./crypto";
import type { BookmarkTag, BookmarkTweet } from "./x-api";

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

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

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

      CREATE TABLE IF NOT EXISTS api_usage_resources (
        billing_window TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        PRIMARY KEY (billing_window, resource_id)
      );

      CREATE TABLE IF NOT EXISTS bookmark_notes (
        tweet_id TEXT PRIMARY KEY,
        note TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookmark_view_states (
        tweet_id TEXT PRIMARY KEY,
        collapsed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookmark_tags (
        tweet_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tweet_id, tag_id),
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );
    `);

    ensureColumn(db, "cached_bookmark_tweets", "x_bookmarked", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn(db, "cached_bookmark_tweets", "last_seen_on_x_at", "INTEGER");
    ensureColumn(db, "cached_bookmark_tweets", "unbookmarked_at", "INTEGER");
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

type StoredTagRow = {
  id: number;
  name: string;
  color: string;
  sort_order: number;
};

function toBookmarkTag(row: StoredTagRow): BookmarkTag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: row.sort_order
  };
}

function getTagsForTweetIds(tweetIds: string[]) {
  const uniqueIds = [...new Set(tweetIds)].filter(Boolean);
  if (uniqueIds.length === 0) {
    return new Map<string, BookmarkTag[]>();
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `
      SELECT
        bookmark_tags.tweet_id,
        tags.id,
        tags.name,
        tags.color,
        tags.sort_order
      FROM bookmark_tags
      INNER JOIN tags ON tags.id = bookmark_tags.tag_id
      WHERE bookmark_tags.tweet_id IN (${placeholders})
      ORDER BY tags.sort_order ASC, tags.id ASC
    `
    )
    .all(...uniqueIds) as (StoredTagRow & { tweet_id: string })[];

  const tagsByTweetId = new Map<string, BookmarkTag[]>();
  for (const row of rows) {
    const current = tagsByTweetId.get(row.tweet_id) ?? [];
    current.push(toBookmarkTag(row));
    tagsByTweetId.set(row.tweet_id, current);
  }

  return tagsByTweetId;
}

function attachTags(items: BookmarkTweet[]) {
  const tagsByTweetId = getTagsForTweetIds(items.map((item) => item.id));
  return items.map((item) => ({
    ...item,
    tags: tagsByTweetId.get(item.id) ?? item.tags ?? []
  }));
}

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
    .prepare("SELECT COUNT(*) AS count FROM cached_bookmark_tweets WHERE x_bookmarked = 1")
    .get() as { count: number };
  return row.count;
}

export function getActiveCachedBookmarkIds() {
  const rows = getDb()
    .prepare(
      `
      SELECT tweet_id
      FROM cached_bookmark_tweets
      WHERE x_bookmarked = 1
      ORDER BY sort_order ASC, cached_at DESC
    `
    )
    .all() as { tweet_id: string }[];

  return rows.map((row) => row.tweet_id);
}

export function getCachedBookmarkPage(offset = 0, limit = 50): CachedBookmarkPage {
  const rows = getDb()
    .prepare(
      `
      SELECT
        cached_bookmark_tweets.payload,
        cached_bookmark_tweets.cached_at,
        bookmark_notes.note,
        bookmark_view_states.collapsed
      FROM cached_bookmark_tweets
      LEFT JOIN bookmark_notes ON bookmark_notes.tweet_id = cached_bookmark_tweets.tweet_id
      LEFT JOIN bookmark_view_states ON bookmark_view_states.tweet_id = cached_bookmark_tweets.tweet_id
      WHERE cached_bookmark_tweets.x_bookmarked = 1
      ORDER BY cached_bookmark_tweets.sort_order ASC, cached_bookmark_tweets.cached_at DESC
      LIMIT ? OFFSET ?
    `
    )
    .all(limit, offset) as { payload: string; cached_at: number; note: string | null; collapsed: number | null }[];

  const total = getCachedBookmarkCount();

  const items = rows.map((row) => ({
      ...(JSON.parse(row.payload) as BookmarkTweet),
      cachedAt: new Date(row.cached_at).toISOString(),
      note: row.note,
      collapsed: row.collapsed === 1
    }));

  return {
    items: attachTags(items),
    nextToken: offset + rows.length < total ? `cache:${offset + rows.length}` : null
  };
}

export function applyLocalBookmarkState(items: BookmarkTweet[]) {
  if (items.length === 0) {
    return items;
  }

  const ids = items.map((item) => item.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `
      SELECT cached_bookmark_tweets.tweet_id, bookmark_notes.note, bookmark_view_states.collapsed
      FROM cached_bookmark_tweets
      LEFT JOIN bookmark_notes ON bookmark_notes.tweet_id = cached_bookmark_tweets.tweet_id
      LEFT JOIN bookmark_view_states ON bookmark_view_states.tweet_id = cached_bookmark_tweets.tweet_id
      WHERE cached_bookmark_tweets.tweet_id IN (${placeholders})
    `
    )
    .all(...ids) as { tweet_id: string; note: string | null; collapsed: number | null }[];

  const stateById = new Map(rows.map((row) => [row.tweet_id, row]));
  const withLocalState = items.map((item) => {
    const state = stateById.get(item.id);
    return {
      ...item,
      note: state?.note ?? item.note,
      collapsed: state?.collapsed === 1,
      tags: item.tags ?? []
    };
  });

  return attachTags(withLocalState);
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
      INSERT INTO cached_bookmark_tweets (
        tweet_id,
        payload,
        sort_order,
        cached_at,
        updated_at,
        x_bookmarked,
        last_seen_on_x_at,
        unbookmarked_at
      )
      VALUES (@tweetId, @payload, @sortOrder, @cachedAt, @updatedAt, 1, @cachedAt, NULL)
      ON CONFLICT(tweet_id) DO UPDATE SET
        payload = excluded.payload,
        sort_order = excluded.sort_order,
        cached_at = excluded.cached_at,
        updated_at = excluded.updated_at,
        x_bookmarked = 1,
        last_seen_on_x_at = excluded.cached_at,
        unbookmarked_at = NULL
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

  return applyLocalBookmarkState(items.map((item) => ({ ...item, cachedAt: new Date(now).toISOString() })));
}

export function saveSyncedBookmarkPage(items: BookmarkTweet[], offset: number) {
  const now = Date.now();
  const db = getDb();

  db.transaction(() => {
    const statement = db.prepare(
      `
      INSERT INTO cached_bookmark_tweets (
        tweet_id,
        payload,
        sort_order,
        cached_at,
        updated_at,
        x_bookmarked,
        last_seen_on_x_at,
        unbookmarked_at
      )
      VALUES (@tweetId, @payload, @sortOrder, @cachedAt, @updatedAt, 1, @cachedAt, NULL)
      ON CONFLICT(tweet_id) DO UPDATE SET
        payload = excluded.payload,
        sort_order = excluded.sort_order,
        cached_at = excluded.cached_at,
        updated_at = excluded.updated_at,
        x_bookmarked = 1,
        last_seen_on_x_at = excluded.last_seen_on_x_at,
        unbookmarked_at = NULL
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
  })();

  return applyLocalBookmarkState(items.map((item) => ({ ...item, cachedAt: new Date(now).toISOString() })));
}

export function markBookmarksNotSeenOnX(seenTweetIds: string[], targetTweetIds: string[]) {
  const now = Date.now();
  const db = getDb();
  const uniqueIds = [...new Set(seenTweetIds)].filter(Boolean);
  const uniqueTargetIds = [...new Set(targetTweetIds)].filter(Boolean);

  if (uniqueTargetIds.length === 0) {
    return 0;
  }

  return db.transaction(() => {
    db.prepare("CREATE TEMP TABLE IF NOT EXISTS synced_bookmark_ids (tweet_id TEXT PRIMARY KEY)").run();
    db.prepare("CREATE TEMP TABLE IF NOT EXISTS sync_target_bookmark_ids (tweet_id TEXT PRIMARY KEY)").run();
    db.prepare("DELETE FROM synced_bookmark_ids").run();
    db.prepare("DELETE FROM sync_target_bookmark_ids").run();

    const insertSeen = db.prepare("INSERT OR IGNORE INTO synced_bookmark_ids (tweet_id) VALUES (?)");
    uniqueIds.forEach((tweetId) => insertSeen.run(tweetId));

    const insertTarget = db.prepare("INSERT OR IGNORE INTO sync_target_bookmark_ids (tweet_id) VALUES (?)");
    uniqueTargetIds.forEach((tweetId) => insertTarget.run(tweetId));

    const result = db
      .prepare(
        `
        UPDATE cached_bookmark_tweets
        SET x_bookmarked = 0,
            unbookmarked_at = COALESCE(unbookmarked_at, ?),
            updated_at = ?
        WHERE x_bookmarked = 1
          AND EXISTS (
            SELECT 1 FROM sync_target_bookmark_ids
            WHERE sync_target_bookmark_ids.tweet_id = cached_bookmark_tweets.tweet_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM synced_bookmark_ids
            WHERE synced_bookmark_ids.tweet_id = cached_bookmark_tweets.tweet_id
          )
      `
      )
      .run(now, now);

    db.prepare("DELETE FROM synced_bookmark_ids").run();
    db.prepare("DELETE FROM sync_target_bookmark_ids").run();
    return result.changes;
  })();
}

export function markBookmarkXState(tweetId: string, xBookmarked: boolean) {
  const now = Date.now();
  getDb()
    .prepare(
      `
      UPDATE cached_bookmark_tweets
      SET x_bookmarked = ?,
          last_seen_on_x_at = CASE WHEN ? = 1 THEN ? ELSE last_seen_on_x_at END,
          unbookmarked_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(unbookmarked_at, ?) END,
          updated_at = ?
      WHERE tweet_id = ?
    `
    )
    .run(xBookmarked ? 1 : 0, xBookmarked ? 1 : 0, now, xBookmarked ? 1 : 0, now, now, tweetId);
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
        cached_at = excluded.cached_at,
        updated_at = excluded.updated_at,
        x_bookmarked = 1,
        last_seen_on_x_at = excluded.cached_at,
        unbookmarked_at = NULL
    `
    )
    .run({
      tweetId: tweet.id,
      payload: JSON.stringify(tweet),
      cachedAt: now,
      updatedAt: now
    });

  return applyLocalBookmarkState([{ ...tweet, cachedAt: new Date(now).toISOString() }])[0];
}

export function saveBookmarkNote(tweetId: string, note: string) {
  const trimmed = note.trim();
  const db = getDb();

  if (!trimmed) {
    db.prepare("DELETE FROM bookmark_notes WHERE tweet_id = ?").run(tweetId);
    return;
  }

  db.prepare(
    `
    INSERT INTO bookmark_notes (tweet_id, note, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(tweet_id) DO UPDATE SET
      note = excluded.note,
      updated_at = excluded.updated_at
  `
  ).run(tweetId, note, Date.now());
}

export function deleteBookmarkNote(tweetId: string) {
  getDb().prepare("DELETE FROM bookmark_notes WHERE tweet_id = ?").run(tweetId);
}

export function saveBookmarkCollapsed(tweetId: string, collapsed: boolean) {
  getDb()
    .prepare(
      `
      INSERT INTO bookmark_view_states (tweet_id, collapsed, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(tweet_id) DO UPDATE SET
        collapsed = excluded.collapsed,
        updated_at = excluded.updated_at
    `
    )
    .run(tweetId, collapsed ? 1 : 0, Date.now());
}

export function getTags() {
  const rows = getDb()
    .prepare(
      `
      SELECT id, name, color, sort_order
      FROM tags
      ORDER BY sort_order ASC, id ASC
    `
    )
    .all() as StoredTagRow[];

  return rows.map(toBookmarkTag);
}

export function createTag(name: string, color: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("TAG_NAME_REQUIRED");
  }

  const now = Date.now();
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM tags")
    .get() as { next_order: number };

  const result = getDb()
    .prepare(
      `
      INSERT INTO tags (name, color, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
    )
    .run(trimmed, color, row.next_order, now, now);

  return {
    id: Number(result.lastInsertRowid),
    name: trimmed,
    color,
    sortOrder: row.next_order
  };
}

export function updateTag(tagId: number, updates: { name?: string; color?: string; sortOrder?: number }) {
  const current = getDb()
    .prepare("SELECT id, name, color, sort_order FROM tags WHERE id = ?")
    .get(tagId) as StoredTagRow | undefined;

  if (!current) {
    throw new Error("TAG_NOT_FOUND");
  }

  const nextName = updates.name === undefined ? current.name : updates.name.trim();
  if (!nextName) {
    throw new Error("TAG_NAME_REQUIRED");
  }

  const nextColor = updates.color ?? current.color;
  const nextSortOrder = Number.isFinite(updates.sortOrder) ? Number(updates.sortOrder) : current.sort_order;

  getDb()
    .prepare(
      `
      UPDATE tags
      SET name = ?, color = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `
    )
    .run(nextName, nextColor, nextSortOrder, Date.now(), tagId);

  return {
    id: tagId,
    name: nextName,
    color: nextColor,
    sortOrder: nextSortOrder
  };
}

export function deleteTag(tagId: number) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM bookmark_tags WHERE tag_id = ?").run(tagId);
    db.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
  })();
}

export function replaceBookmarkTags(tweetId: string, tagIds: number[]) {
  const uniqueTagIds = [...new Set(tagIds)]
    .map((tagId) => Number(tagId))
    .filter((tagId) => Number.isInteger(tagId) && tagId > 0);
  const now = Date.now();
  const db = getDb();

  db.transaction(() => {
    db.prepare("DELETE FROM bookmark_tags WHERE tweet_id = ?").run(tweetId);
    const insert = db.prepare("INSERT OR IGNORE INTO bookmark_tags (tweet_id, tag_id, created_at) VALUES (?, ?, ?)");
    for (const tagId of uniqueTagIds) {
      insert.run(tweetId, tagId, now);
    }
  })();

  return getTagsForTweetIds([tweetId]).get(tweetId) ?? [];
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

export function recordApiUsageForResources(operation: string, resourceIds: string[], costPerResourceUsd: number) {
  const uniqueIds = [...new Set(resourceIds)].filter(Boolean);
  if (uniqueIds.length === 0) {
    return 0;
  }

  const now = Date.now();
  const billingWindow = new Date(now).toISOString().slice(0, 10);
  const db = getDb();

  const chargedResources = db.transaction(() => {
    const statement = db.prepare(
      `
      INSERT OR IGNORE INTO api_usage_resources (billing_window, resource_id, operation, occurred_at)
      VALUES (?, ?, ?, ?)
    `
    );

    let inserted = 0;
    for (const id of uniqueIds) {
      const result = statement.run(billingWindow, id, operation, now);
      inserted += result.changes;
    }

    if (inserted > 0) {
      db.prepare(
        `
        INSERT INTO api_usage (occurred_at, operation, resources, estimated_cost_usd)
        VALUES (?, ?, ?, ?)
      `
      ).run(now, operation, inserted, inserted * costPerResourceUsd);
    }

    return inserted;
  })();

  return chargedResources;
}

export function getEstimatedApiUsageUsd() {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost FROM api_usage")
    .get() as { cost: number };
  const offset = Number(process.env.X_API_USAGE_OFFSET_USD ?? "1.039");
  return row.cost + (Number.isFinite(offset) && offset >= 0 ? offset : 1.039);
}
