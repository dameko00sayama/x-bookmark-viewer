# Changelog

## v1.4.0 - 2026-05-29

- Feature: Rename the header refresh action to "取得" to reflect that it only fetches the latest page.
- Feature: Add a confirmed "同期" action that fetches all X bookmark pages and marks locally cached items missing from X as unbookmarked.
- Feature: Track X bookmark state locally so unbookmarked cached tweets can be hidden without deleting local data.
- Chore: Bump app version to v1.4.0.

## v1.3.1 - 2026-05-29

- Feature: Add a persistent local collapsed state for bookmark cards.
- Feature: Show collapsed cards as only the account, first text line, and an open button.
- Docs: Mark the collapsed-card requirement as implemented in the expansion notes.
- Chore: Bump app version to v1.3.1.

## v1.2.2 - 2026-05-29

- Feature: Show each bookmark card's last fetched cache timestamp near the local note controls.
- Fix: Update cached timestamps when bookmarks or full tweet details are refreshed.

## v1.2.1 - 2026-05-28

- Feature: Show refresh progress with a spinner, progress bar, and temporary success checkmark.
- Feature: Display whether the current bookmark list came from X API or the local cache.
- Docs: Document the local development policy to keep the app on port 8080.

## v1.2.0 - 2026-05-28

- Security: Ignore all `.env*` files while keeping `.env.example` tracked.
- Security: Stop exposing OAuth failure details in redirect URLs and server logs.
- Security: Disable external translation by default; require `ENABLE_EXTERNAL_TRANSLATION=1` to send post text to translation services.
- Safety: Require authentication before saving local bookmark notes.
- Safety: Preserve local notes when removing a bookmark from X, reducing rollback/Undo impact.
- Feature: Add DB backup and restore scripts.
- Docs: Add security, rollback, DB handling, and operation guidance.

## v1.1.1 - 2026-05-27

- Fix: Proxy X video media through `/api/media/video` so bookmark videos can play reliably.
- Fix: Add an explicit video play overlay and playback error message in bookmark cards.

## v1.1.0 - 2026-05-27

- Feature: Display author handles inline as `Name (@handle)` in bookmark cards.
- Feature: Add hover color and underline affordances to clickable author/date areas.

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
