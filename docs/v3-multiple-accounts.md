# v3 複数アカウント仕様

## 目的

複数の X アカウントのブックマークを、1つのローカル SQLite DB に集約して閲覧できるようにする。

## 画面

### `/auth`

認証とアカウント管理の専用ページ。

- 登録済みアカウント一覧
- active アカウント表示
- `Add X account`
- `Set active`
- `Open viewer`
- `Remove local tokens`

### `/`

統合ブックマークビュー。

- 登録済みアカウントの取得済みブックマークを横断表示
- 同一 tweet id は1件に集約
- カード上に由来アカウントをチップ表示

## active アカウント

active アカウントは次の操作対象になる。

- 取得
- 同期
- ブックマーク解除
- Undo
- スレッド/全文取得での X API 呼び出し

統合表示は active に限定しない。登録済みアカウントのローカルキャッシュを横断して表示する。

## DB 構造

### `accounts`

X アカウントごとの認証情報を保存する。

- `user_id`
- `username`
- `name`
- `access_token`
- `refresh_token`
- `expires_at`
- `active`
- `created_at`
- `updated_at`

token は `TOKEN_ENCRYPTION_KEY` で暗号化して保存する。

### `cached_bookmark_tweets`

投稿本文やメディアなど、tweet id 単位で共有できるキャッシュを保存する。  
複数アカウントで同じ投稿をブックマークしていても、投稿本体は1件だけ保存する。

### `account_bookmarks`

どのアカウントがどの tweet id をブックマークしているかを保存する。

- `account_user_id`
- `tweet_id`
- `sort_order`
- `x_bookmarked`
- `last_seen_on_x_at`
- `unbookmarked_at`
- `cached_at`
- `updated_at`

主キーは `(account_user_id, tweet_id)`。

### tweet id 単位で共有するローカル情報

以下はアカウント別ではなく tweet id 単位で共有する。

- `bookmark_notes`
- `bookmark_view_states`
- `tags`
- `bookmark_tags`

## 並び順

既存データの並びは再計算しない。

今後の「取得」では、active アカウントで取得したページを統合ビューの上へ積む。  
そのため `offset === 0` の取得時には、既存の `account_bookmarks.sort_order` を下へ押し、取得ページを `0..n` に配置する。

追加ページの取得では、active アカウント内の既存件数をもとに末尾へ追加する。

## OAuth

X Developer Portal 側の設定:

- OAuth 2.0: Enabled
- App type: Web App
- App permissions: Read and write
- Callback URI / Redirect URL: `http://localhost:8181/api/auth/callback/x`
- Website URL: `http://localhost:8181`

要求 scope:

```txt
tweet.read users.read bookmark.read bookmark.write offline.access
```

認可URLの `scope` は `%20` 区切りで percent encode する。

## 8080 旧DBからの移行

旧DBの `auth.id = 'default'` の `user_id` を移行元アカウントとして扱う。  
8181側に同じ `user_id` の `accounts` レコードが存在する状態で以下をマージする。

- `cached_bookmark_tweets`
- `tags`
- `bookmark_tags`
- `bookmark_notes`
- `bookmark_view_states`
- `account_bookmarks`

移行時の注意:

- 8181側DBを丸ごと上書きしない。
- 8181側の認証 token を保持する。
- 旧DBは WAL を含む可能性があるため SQLite backup API でスナップショットを取る。
- 移行前に 8181 側DBをバックアップする。

