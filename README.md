# X Bookmark Viewer

X のブックマークだけをローカルで読むための個人用 Web ビューアです。  
v3.0.0 では複数 X アカウントを同じ SQLite DB に登録し、取得済みブックマークを横断して1つの一覧として表示できます。

このアプリは X クライアントではありません。タイムライン、通知、DM、検索、投稿、返信、いいね、リポストは扱いません。

## 主な機能

- X OAuth 2.0 PKCE によるアカウント認証
- `/auth` で複数アカウントを登録・確認
- active アカウントの切り替え
- 複数アカウントの取得済みブックマークを統合表示
- ブックマークごとの由来アカウント表示
- ローカル SQLite キャッシュ
- ローカルタグ、タグフィルタ、タグ管理
- ローカルメモ
- 折りたたみ状態保存
- ブックマーク解除と Undo
- X API 利用額の概算表示

## 起動 URL

v3 系は `8181` 固定です。

```txt
http://localhost:8181
```

認証・アカウント管理ページ:

```txt
http://localhost:8181/auth
```

## セットアップ

`.env.example` を `.env` にコピーします。

```bash
cp .env.example .env
```

`.env` を設定します。

```env
X_CLIENT_ID=your-x-client-id
X_CLIENT_SECRET=your-x-client-secret
X_CALLBACK_URL=http://localhost:8181/api/auth/callback/x
APP_BASE_URL=http://localhost:8181
TOKEN_ENCRYPTION_KEY=replace-with-a-long-random-secret
DATA_DIR=/app/data
X_API_CHARGE_USD=5
X_API_USAGE_OFFSET_USD=1.039
ENABLE_EXTERNAL_TRANSLATION=0
```

`TOKEN_ENCRYPTION_KEY` は保存済み OAuth token の暗号化に使います。変更すると既存 token を復号できなくなるため、初回設定後は原則変えないでください。

## X Developer Portal

X Developer Portal の対象 App で User authentication settings を設定します。

- OAuth 2.0: Enabled
- App type: Web App
- App permissions: Read and write
- Callback URI / Redirect URL: `http://localhost:8181/api/auth/callback/x`
- Website URL: `http://localhost:8181`

要求 scope:

```txt
tweet.read users.read bookmark.read bookmark.write offline.access
```

`bookmark.write` はブックマーク解除と Undo に使います。読み取りだけで切り分けたい場合は、コード側の scope から `bookmark.write` を外し、X 側 App permissions も合わせてください。

## Docker 起動

通常起動:

```bash
docker compose up -d --build
```

v3 検証用の分離環境:

```bash
docker compose -f docker-compose.test.yml up -d --build
```

停止:

```bash
docker compose down
```

DB volume も削除する場合:

```bash
docker compose down -v
```

## 使い方

1. `http://localhost:8181/auth` を開く。
2. `Add X account` から X OAuth を通す。
3. 複数アカウントを追加する場合は、X 側でアカウントを切り替えてから再度 `Add X account` を押す。
4. 取得・同期対象にしたいアカウントを `Set active` で active にする。
5. `Open viewer` で一覧へ移動する。
6. 一覧の「取得」は active アカウントの最新ブックマークを取得する。

統合ビューでは、複数アカウントに同じ投稿がある場合は1件にまとめ、カード上に由来アカウントを表示します。

## 並び順

既存データの並びは保持します。  
今後「取得」を実行した場合、その active アカウントで取得された新しいページを統合ビューの上部に積み、既存分は下へ送ります。

イメージ:

```txt
今回取得したアカウントAのブックマーク
前回取得したアカウントBのブックマーク
既存の取得済みブックマーク
```

## ローカル保存データ

SQLite に保存するもの:

- 暗号化済み OAuth token / refresh token
- X user id / username / name
- OAuth state
- 取得済みブックマーク本文
- 投稿者情報
- メディア URL / alt text
- 引用ポスト情報
- アカウント別ブックマーク所属
- ローカルタグ
- ローカルメモ
- 折りたたみ状態
- X API 利用額概算

DB、バックアップ、スクリーンショット、ログには個人データが含まれる可能性があります。公開リポジトリや外部ストレージへ置かないでください。

## 既存 8080 データの移行

v2 までの 8080 環境で取得したブックマーク、タグ、メモ、折りたたみ状態は v3 の 8181 DB へマージできます。  
丸ごと DB を上書きすると新しい認証 token が消えるため、移行時は以下だけをマージします。

- `cached_bookmark_tweets`
- `tags`
- `bookmark_tags`
- `bookmark_notes`
- `bookmark_view_states`
- `account_bookmarks` への所属復元

移行前には必ず 8181 側 DB のバックアップを取ってください。

詳細な v3 複数アカウント仕様は [docs/v3-multiple-accounts.md](docs/v3-multiple-accounts.md) を参照してください。

## トラブルシュート

- X OAuth で「アプリにアクセスを許可できません」が出る:
  - X Developer Portal の Callback URI が `.env` の `X_CALLBACK_URL` と完全一致しているか確認する。
  - `http://localhost:8181/api/auth/callback/x` に末尾 `/` を付けない。
  - App permissions が `Read and write` になっているか確認する。
  - `.env` の `X_CLIENT_ID` / `X_CLIENT_SECRET` が、設定した X App のものか確認する。

- `AUTH_REQUIRED` が出る:
  - `/auth` でアカウントを追加し直す。

- `BUDGET_EXCEEDED` が出る:
  - `X_API_CHARGE_USD` と `X_API_USAGE_OFFSET_USD` を確認する。

- token を消したい:
  - `/auth` の `Remove local tokens` を使う。
