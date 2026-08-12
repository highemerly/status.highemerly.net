# status.highemerly.net

はんドンクラブほか各サービスのステータスページ。

Prometheus のデータを 5 分ごとに Lambda が集計し、静的サイトとして CloudFront から配信する。

---

## アーキテクチャ

```
[GitHub リポジトリ]
   │ push
   ▼
[GitHub Actions] ──build & sync──> [S3] ──> [CloudFront] ──> [ユーザー]
                                     ▲
                                     │ data/status.v1.json を 5 分ごとに更新
                              [Lambda: update-status]
                                     ▲
                              [EventBridge cron(5分)]
                                     │
                               [Prometheus]
```

- **フロントは静的ファイルのみ**。API Gateway を経由しない
- **CloudFront invalidation を使わない**。`Cache-Control` の `s-maxage` で制御する
  （5 分ごとに invalidation を打つと月 $38 かかるため）
- **AWS 認証は OIDC**。GitHub に長期のアクセスキーを置かない

| ドキュメント | 内容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 触るときの注意（踏みやすい落とし穴をまとめてある） |
| [docs/AWS_SETUP.md](docs/AWS_SETUP.md) | AWS 側の手動セットアップ手順 |
| [docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md) | 作り直しの経緯と旧実装の原因分析 |
| [SECURITY.md](SECURITY.md) | 機密情報の扱いと IAM の原則 |

---

## ローカル開発

```bash
npm install
node scripts/dev-data.js   # ダミーの status.json を public/ に生成
npm run dev                # http://localhost:3000
```

`scripts/dev-data.js` は 48 時間分のダミー履歴（障害を数回含む）を作る。
生成物は `.gitignore` 済みで、設定の正本は `config/services.json` のみ。

```bash
npm run build              # 静的エクスポート（out/ に出力）
node scripts/verify-schema.js   # スキーマとマージロジックの検証

# Lambda が出力した status.json の検証（切り替え判断に使う）
node scripts/verify-status-json.js https://status.highemerly.net/data/status.v1.json

# 稼働バージョンの取得（k8s リポジトリを読む）
K8S_REPO=../k8sg1 GITHUB_TOKEN=$(gh auth token) node scripts/build-versions.js
```

---

## デプロイ

`main` に push すると [GitHub Actions](.github/workflows/deploy.yml) が S3 に sync する。
手動実行は Actions タブの **Deploy** から。

反映までの時間は最大 60 秒（CloudFront の `s-maxage`）。

Lambda は別途デプロイする:

```bash
./scripts/deploy-lambda.sh
```

---

## データ形式

`data/status.v1.json`（Lambda が生成、48 時間分で約 7.5KB）:

```json
{
  "v": 1,
  "updatedAt": "2026-08-06T12:00:00.000Z",
  "step": 300,
  "points": 576,
  "from": "2026-08-04T12:05:00.000Z",
  "to": "2026-08-06T12:00:00.000Z",
  "services": {
    "handon-web": { "status": "up", "ms": 142, "h": "111111d0011111..." }
  }
}
```

`h` は履歴で、**1 文字が 1 点（5 分）**を表す。

| 文字 | 意味 |
|---|---|
| `1` | 正常 |
| `d` | 一部で問題（複数コンポーネントのうち一部が停止） |
| `0` | 停止 |
| `-` | 不明（データなし） |

各点にタイムスタンプを持たせず `from` / `step` から逆算するため、
48 時間分を持っても 7.5KB に収まる（素朴な形式なら 819KB）。

表示期間の切り替え（1h / 3h / 12h / 24h / 48h）は、この文字列の末尾を切るだけで済む。
追加のリクエストは発生しない。

---

## 設定

### config/services.json

サービス定義。機密情報を含まないので git 管理できる。
`name` と `description` は文字列（日本語のみ）か `{ "ja": "...", "en": "..." }` を受け付ける。

```json
{
  "id": "handon-web",
  "name": "Web",
  "description": { "ja": "投稿の閲覧と作成", "en": "Browsing and posting" },
  "prometheusQuery": "probe_http_status_code{endpoint='web', service='handon'}",
  "categoryId": "handon-club"
}
```

`prometheusQuery` に配列を渡すと、複数コンポーネントをまとめて 1 サービスとして扱う。
全部正常なら `up`、一部だけ停止なら `degraded`、全部停止なら `down`。

データが無い区間は `unknown`（不明）になる。基盤の死活のように**データが来ないこと自体が異常**な
対象では、`(sum(...) or vector(0)) >= bool 1` と書くと系列が消えた時刻でも 0 が返り `down` になる。
`or` は比較より優先順位が低いので、括弧を省くと `sum(...) or (vector(0) >= bool 1)` に化ける。

カテゴリに `version` を書くと、k8s リポジトリの本番マニフェストから稼働バージョンを取り出す。

```json
{
  "id": "handon-club",
  "version": {
    "manifest": "manifests/handon/prd/web.yaml",
    "image": "ghcr.io/highemerly/mastodon",
    "displayPattern": "^(\\d+\\.\\d+\\.\\d+)",
    "releases": { "repo": "mastodon/mastodon", "tagPrefix": "v" }
  }
}
```

`releases` はタグ名で GitHub Releases API を直接引く。
`releases` を省く、または該当タグのリリースが無い場合は、バージョンだけ表示して
リリースノートのリンクは出さない。

パッチ版のリリースノートを切っていないサービス向けに、代替タグを指定できる。

```json
"releases": {
  "repo": "highemerly/movapic-neo",
  "tagPrefix": "v",
  "fallbackTags": ["{major}.{minor}.0"]
}
```

`v1.4.4` が無ければ `v1.4.0` を引く、という動き。
使える置換は `{version}` `{major}` `{minor}` `{patch}`。
代替に落ちた場合はリンクのツールチップにその旨が出る。

生成物は `config/versions.json`
（[update-versions ワークフロー](.github/workflows/update-versions.yml)が日次でコミットする）。

### お知らせ

ページ上部の「お知らせ」欄。Discord の `/announce` から投稿・削除する。

```
/announce action:create title:メンテナンスのお知らせ body:... level:maintenance
/announce action:delete id:2026-08-07-09-30-56
```

`DiscordInteractionFunction` が S3 の `data/announcements.json` を直接書き換える。
GitHub は経由しない。反映は 1 分以内（CloudFront の `s-maxage`）。最大 20 件まで保持する。

### 機密情報

AWS SSM Parameter Store で管理する。

```
/status-page/prometheus/url
/status-page/prometheus/username    (SecureString)
/status-page/prometheus/password    (SecureString)
/status-page/discord/public-key     (SecureString)
```

詳細は [SECURITY.md](SECURITY.md)。

---

## 技術スタック

- Next.js 16（静的エクスポート）+ TypeScript + TailwindCSS
- AWS Lambda / S3 / CloudFront / EventBridge / Route53
- Prometheus
- GitHub Actions

---

## 作り直しの進捗

| # | 内容 | 状態 |
|---|---|---|
| 1 | GitHub Actions で S3 sync（OIDC） | 完了 |
| 2 | status.json 新スキーマ + Lambda cron 化 | 完了 |
| 3 | フロントエンド刷新 | 完了 |
| 4 | お知らせ機能の作り直し（Discord → S3 直接） | 完了 |
| 5 | バージョン / リリースノート表示 | 完了 |

**すべて本番稼働中。** 経緯と、旧実装で見つかった不具合の原因分析は
[docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md) にある。

### 残っていること

- **Terraform 化**。構成が固まったので着手できる。手動で作ったリソースの
  設定値は [docs/AWS_SETUP.md](docs/AWS_SETUP.md) に記録してある
- **旧構成の撤去**。`UpdateStatusFunction`、API Gateway の `/api/v1/status`、
  `data/status.json`、`data/messages.json`。切り戻し先なので数日置いてから
- **ステータスの手動上書き**。旧 `/status` コマンドで出来たが未実装

---

## ライセンス

MIT

## Author

はん (highemerly)
