"use client";

import { useEffect, useMemo, useState } from "react";
import packageJson from "@/package.json";

type AccountSummary = {
  userId: string;
  username: string | null;
  name: string | null;
  active: boolean;
};

type AuthPayload = {
  authenticated: boolean;
  userId?: string;
  username?: string | null;
  name?: string | null;
  accounts?: AccountSummary[];
};

const ERROR_MESSAGES: Record<string, string> = {
  oauth_state: "OAuth state could not be verified. Please try signing in again.",
  oauth_failed: "X OAuth failed. Check the app settings and callback URL.",
  missing_config: "X_CLIENT_ID is missing. Check the environment settings."
};

export default function AuthAccountsPage() {
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<AuthPayload>({ authenticated: false });
  const [error, setError] = useState<string | null>(null);

  const loginError = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("error");
    return raw ? ERROR_MESSAGES[raw] ?? raw : null;
  }, []);

  async function loadAuth() {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const payload = (await response.json()) as AuthPayload;
      setAuth(payload);
      setError(null);
    } catch {
      setError("Could not load authentication state.");
    } finally {
      setLoading(false);
    }
  }

  async function logoutAll() {
    const ok = window.confirm("Remove all locally saved X account tokens from this test environment?");
    if (!ok) {
      return;
    }

    await fetch("/api/auth/logout", { method: "POST" });
    await loadAuth();
  }

  async function setActiveAccount(userId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/auth/accounts/${encodeURIComponent(userId)}/active`, {
        method: "POST"
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "ACCOUNT_SWITCH_FAILED");
      }
      await loadAuth();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not switch active account.");
    }
  }

  useEffect(() => {
    void loadAuth();
  }, []);

  const accounts = auth.accounts ?? [];
  const activeAccount = accounts.find((account) => account.active) ?? accounts[0] ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[760px] flex-col px-6 py-8">
      <header className="mb-6 border-b border-line pb-5">
        <p className="text-sm font-semibold text-quiet">X Bookmark Viewer v{packageJson.version}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Accounts</h1>
        <p className="mt-3 leading-7 text-slate-300">
          Add each X account here once. The viewer can then read all locally authorized bookmark caches as one
          combined database.
        </p>
      </header>

      {loginError || error ? (
        <div className="mb-5 rounded-md border border-red-400/40 bg-red-950/40 p-4 text-sm text-red-100">
          {loginError ?? error}
        </div>
      ) : null}

      <section className="rounded-lg border border-line bg-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Authorized accounts</h2>
            <p className="mt-1 text-sm text-quiet">
              {loading
                ? "Checking..."
                : accounts.length > 0
                  ? `${accounts.length} account${accounts.length === 1 ? "" : "s"} saved locally`
                  : "No X accounts are saved yet"}
            </p>
          </div>
          <a
            href="/api/auth/login"
            className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-slate-200"
          >
            Add X account
          </a>
        </div>

        <div className="mt-5 space-y-3">
          {accounts.map((account) => (
            <div
              key={account.userId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-ink px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-100">
                  @{account.username ?? account.userId}
                  {account.active ? (
                    <span className="ml-2 rounded-full border border-emerald-500/50 px-2 py-0.5 text-xs text-emerald-200">
                      active
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-quiet">{account.name ?? account.userId}</p>
              </div>
              {account.active ? (
                <span className="text-xs text-slate-500">bookmark.read / bookmark.write</span>
              ) : (
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-panel"
                  onClick={() => setActiveAccount(account.userId)}
                >
                  Set active
                </button>
              )}
            </div>
          ))}

          {!loading && accounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-ink/50 p-5 text-sm text-slate-300">
              Start by adding the first account. To add another account, switch accounts on X during the OAuth flow and
              return here.
            </div>
          ) : null}
        </div>
      </section>

      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="/"
          className={`rounded-md px-5 py-3 text-sm font-semibold transition ${
            activeAccount ? "bg-sky-300 text-ink hover:bg-sky-200" : "cursor-not-allowed bg-slate-700 text-slate-400"
          }`}
          aria-disabled={!activeAccount}
          onClick={(event) => {
            if (!activeAccount) {
              event.preventDefault();
            }
          }}
        >
          Open viewer
        </a>
        {accounts.length > 0 ? (
          <button
            type="button"
            className="rounded-md border border-red-400/50 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-950/50"
            onClick={logoutAll}
          >
            Remove local tokens
          </button>
        ) : null}
      </div>
    </main>
  );
}
