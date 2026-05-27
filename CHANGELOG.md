# Changelog

## v1.0.0 - 2026-05-27

- Release: Promote the local X Bookmark Viewer workflow to v1.0.0.
- Feature: Prefer SQLite cache for initial bookmark display and load more from cache before calling X API.
- Feature: Add local per-bookmark notes.
- Feature: Show app version and estimated monthly X API cost.
- Feature: Link URLs in post text and render video media in cards.
- Chore: Document local cache storage, budget configuration, and Docker volume behavior.

## 2026-05-27

- Fix: Use `https://x.com/i/oauth2/authorize` in `lib/x-api.ts` (OAuth authorization URL)
- Fix: Include response body in OAuth token and user fetch errors in `lib/x-api.ts`
- Fix: Log OAuth callback errors and include `reason` query param in `app/api/auth/callback/x/route.ts`
- Fix: Default `missing_config` redirect to `http://localhost:8080` in `app/api/auth/login/route.ts`
- Feature: Display detailed login failure reason (when provided) in `components/BookmarkViewer.tsx`
- Feature: Web fallback to fetch full tweet text when API-provided text is truncated (`lib/x-api.ts`)
- Feature: Server-side `?expand=thread` for `/api/tweets/[tweetId]` to assemble thread text (`app/api/tweets/[tweetId]/route.ts`)
- Chore: Cleaned `.next`, rebuilt, and restarted dev server on port 8080 during debugging

Notes:
- These changes were committed locally. They have not been pushed to GitHub.
