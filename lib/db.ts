import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { decryptText, encryptText } from "./crypto";

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
