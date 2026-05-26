# X Bookmark Viewer

X/Twitterのブックマークだけを表示する、個人用ローカルWebビューワです。

このアプリはX cloneではありません。タイムライン、通知、DM、検索、プロフィール巡回導線、投稿、返信、いいね、リポストは実装していません。

## できること

- X OAuth 2.0 PKCEでログイン
- ブックマーク済みポストを50件ずつ表示
- 「もっと読む」ボタンで明示的に追加取得
- 画像をアプリ内モーダルで表示
- ブックマーク解除
- 解除直後のUndo

投稿本文、投稿一覧、投稿者情報、メディア情報、ブックマーク全量データはSQLiteに保存しません。永続保存するのは暗号化したOAuthトークン、ユーザーID、設定用の最低限の領域だけです。

## 初回セットアップ

1. `.env.example` を `.env` にコピーします。

```bash
cp .env.example .env
```

2. `.env` を編集します。

```env
X_CLIENT_ID=your-x-client-id
X_CLIENT_SECRET=your-x-client-secret
X_CALLBACK_URL=http://localhost:8080/api/auth/callback/x
APP_BASE_URL=http://localhost:8080
TOKEN_ENCRYPTION_KEY=replace-with-a-long-random-secret
DATA_DIR=/app/data
```

`TOKEN_ENCRYPTION_KEY` は十分に長いランダム文字列、または32バイトのbase64文字列を指定してください。変更すると保存済みトークンを復号できなくなります。

`.env` を作成・変更した後は、コンテナを再作成してください。

```bash
docker-compose up -d --build
```

## X Developer設定

X Developer PortalでOAuth 2.0を有効にし、以下を設定してください。

- App type: Web App / Confidential Client
- Callback URL: `http://localhost:8080/api/auth/callback/x`
- Website URL: `http://localhost:8080`
- Scopes: `tweet.read users.read bookmark.read bookmark.write offline.access`

OAuth 2.0 Authorization Code Flow with PKCEを使います。スクレイピングは行いません。

## 起動

```bash
docker compose up -d
```

ブラウザで開きます。

```txt
http://localhost:8080
```

## 停止

```bash
docker compose down
```

トークンDBを含むDocker volumeも削除する場合:

```bash
docker compose down -v
```

## ディレクトリ構成

```txt
app/          Next.js画面とRoute Handlers
components/   ブックマーク専用UI
lib/          SQLite、暗号化、OAuth、X APIクライアント
docs/         仕様書とCodex投入プロンプト
```

## トラブルシュート

- ログイン後にエラーになる: X Developer PortalのCallback URLが `.env` の `X_CALLBACK_URL` と一致しているか確認してください。
- `AUTH_REQUIRED` が出る: 認証切れです。再ログインしてください。
- `BILLING_REQUIRED` が出る: X APIがHTTP 402を返しています。Developer PortalでAPIアクセスプラン、支払い設定、対象Appの権限を確認してください。ブックマーク取得APIはXのOwned Reads課金対象です。
- `RATE_LIMITED` が出る: X API制限に達しています。しばらく待ってから「更新」を押してください。
- Docker起動に失敗する: `.env` が存在するか、`X_CLIENT_ID` と `TOKEN_ENCRYPTION_KEY` が設定されているか確認してください。
- 保存済みログインを消したい: `docker compose down -v` でvolumeを削除してください。
