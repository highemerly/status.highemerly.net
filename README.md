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

詳細は [docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md)、
セットアップ手順は [docs/AWS_SETUP.md](docs/AWS_SETUP.md) を参照。

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

`releases` を省く、または該当タグのリリースが無い場合は、バージョンだけ表示して
リリースノートのリンクは出さない。生成物は `config/versions.json`
（[update-versions ワークフロー](.github/workflows/update-versions.yml)が日次でコミットする）。

### content/announcements/

ページ上部の「お知らせ」欄。`*.md` を置いて push すれば公開され、消せば消える。
書き方は [content/announcements/README.md](content/announcements/README.md) を参照。

Discord の `/announce` からも投稿できる。Bot は S3 を直接触らず、GitHub に
`repository_dispatch` を送るだけで、実際にファイルを作るのは
[announce ワークフロー](.github/workflows/announce.yml)。
**そのため Discord 経由でも変更履歴が git に残る。**

### 機密情報

AWS SSM Parameter Store で管理する。

```
/status-page/prometheus/url
/status-page/prometheus/username    (SecureString)
/status-page/prometheus/password    (SecureString)
/status-page/discord/public-key     (SecureString)
/status-page/github/token           (SecureString) お知らせ投稿用の PAT
```

詳細は [SECURITY.md](SECURITY.md)。

---

## 技術スタック

- Next.js 16（静的エクスポート）+ TypeScript + TailwindCSS
- AWS Lambda / S3 / CloudFront / EventBridge / Route53
- Prometheus
- GitHub Actions

---

## 進行中の作り直し

[docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md) に計画と、旧実装の不具合の原因分析がある。

| # | 内容 | 状態 |
|---|---|---|
| 1 | GitHub Actions で S3 sync（OIDC） | **本番稼働中** |
| 2 | status.json 新スキーマ + Lambda cron 化 | **本番稼働中** |
| 3 | フロントエンド刷新 | **本番稼働中** |
| 4 | お知らせ機能の置き換え（Discord → GitHub Actions） | コード完了 / Lambda 差し替え待ち |
| 5 | バージョン / リリースノート表示 | 表示は稼働中 / PAT 登録待ち |

> **以下のドキュメントは旧アーキテクチャのもので、内容が古い。**
> 手順 4・5 の完了後に整理する。
> `MANUAL_DEPLOYMENT_GUIDE.md` / `QUICKSTART_MANUAL.md` / `DEPLOYMENT.md` / `AWS_ARCHITECTURE.md`

---

## ライセンス

MIT

## Author

はん (highemerly)
