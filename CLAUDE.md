# CLAUDE.md

はん（highemerly）が運営するサービスのステータスページ。
Prometheus（実体は VictoriaMetrics）の観測結果を 5 分ごとに集計し、
静的サイトとして CloudFront から配信する。

**このリポジトリは公開されている。** 実際のアカウント ID や
シークレットを書かないこと（詳細は「触るときの注意」を参照）。

## 構成

```
[GitHub] --push--> [Actions] --sync--> [S3] --> [CloudFront] --> [ユーザー]
                                        ▲
                       5分ごと          │  お知らせ
              [Lambda: StatusPageUpdateStatus]  [Lambda: DiscordInteractionFunction]
                        ▲                                ▲
              [EventBridge cron]                   [Discord /announce]
                        │
                  [Prometheus]
```

フロントエンドは静的ファイルを fetch するだけ。**API Gateway を経由しない。**

| ファイル | 書く主体 | 内容 |
|---|---|---|
| `data/status.v1.json` | Lambda | 稼働状況（48 時間分・約 7.5KB） |
| `data/announcements.json` | Lambda | お知らせ（最大 20 件） |
| `config/services.json` | Actions | サービス定義 |
| `config/versions.json` | Actions | 稼働バージョン |
| HTML / `_next/` | Actions | ビルド成果物 |

## よく使うコマンド

```bash
npm install
node scripts/dev-data.js   # ダミーデータを public/ に生成（本番データは触らない）
npm run dev                # http://localhost:3000
npm run build              # 静的エクスポート（out/）

node scripts/verify-schema.js                    # スキーマとマージロジックの検証
node scripts/verify-status-json.js <URL|パス>    # Lambda 出力の検証
K8S_REPO=../k8sg1 GITHUB_TOKEN=$(gh auth token) node scripts/build-versions.js
```

デプロイは `main` への push（Actions が自動 sync）。
Lambda はコンソールに貼って更新する（後述）。

## 触るときの注意

過去に実際に踏んだものを挙げる。どれも再現しやすい。

### S3 の書き込み領域を混ぜない

`data/` は **Lambda だけ**が書く。それ以外は **Actions だけ**が書く。
Actions のロールには `data/` への `Deny` が入っていて、
`aws s3 sync --delete` が Lambda の出力を消す事故を防いでいる。

**Actions が作るファイルを `data/` に置いてはいけない**（自分で禁止した場所に書くことになる）。

### CloudFront invalidation は使わない

5 分ごとに打つと**月 $38** かかる（無料枠 1,000 パス/月、超過 $0.005/パス）。
`Cache-Control: s-maxage=60` で 60 秒以内に入れ替わるので不要。
漏洩などの緊急時だけ例外。

### Lambda は依存パッケージを持たない

HTTP は標準 `fetch`、署名検証は Node 標準の Ed25519、AWS SDK v3 はランタイム同梱。
**zip を作らずコンソールに貼るだけで更新できる。** この性質は保つこと。

- ランタイムは **Node.js 24.x**
- コンソールの既定は `index.mjs`。**`index.js` にリネームしないと
  `require is not defined` で落ちる**

### GITHUB_TOKEN の push は他のワークフローを起動しない

`update-versions.yml` が `config/versions.json` をコミットしても、
それだけでは Deploy が走らない。**明示的に `gh workflow run deploy.yml` を呼ぶ。**
（`workflow_dispatch` と `repository_dispatch` はこの制限の例外）

### deploy.yml は docs だけの変更では走らない

`paths-ignore` で `docs/**` と `**.md` を除外している。
ドキュメントだけ直して反映したいときは Actions から手動実行する。

### 失敗した実行の Re-run は当時のコミットを使う

`main` が進んでいると push が弾かれる。
原因を直したあとは **Run workflow（`workflow_dispatch`）で新規実行**すること。

### OIDC の `sub` には数値 ID が入る

```
repo:highemerly@3039555/status.highemerly.net@1325293932:ref:refs/heads/main
```

名前だけの `repo:owner/repo:...` では**一致しない**。
実際のクレームは `.github/workflows/debug-oidc.yml` を手動実行すると見られる。

### 公開リポジトリなので実値を書かない

`docs/AWS_SETUP.md` の `<ACCOUNT_ID>` と `<CLOUDFRONT_DISTRIBUTION_ID>` は
意図的に伏せてある。埋めてコミットしないこと。

## データ形式

`data/status.v1.json` の履歴 `h` は **1 文字 = 1 点（5 分）**。

| 文字 | 意味 |
|---|---|
| `1` | 正常 |
| `d` | 一部で問題（一部のコンポーネント、または 5 分のうち一部の時刻が停止） |
| `0` | 停止（5 分間ずっと、全コンポーネントが停止） |
| `-` | 不明 |

各点にタイムスタンプを持たせず `from` / `step` から逆算するため、
48 時間分でも 7.5KB に収まる（素朴な形式なら 819KB）。
表示期間の切り替えは文字列の末尾を切るだけで、追加リクエストが要らない。

**`query_range` は範囲を集計しない。** 評価時刻ごとに直近の 1 サンプルを返すだけなので、
`step=300` で撃つと 5 分ぶんのスクレイプのうち境界に一番近い 1 本しか見ない。
blackbox の `scrape_interval` は 60 秒なので、5 本中 4 本を捨てていた
（5 分のうち 1 回だけ落ちても、境界の 1 本が成功していれば `1` と表示された）。

いまは `SUB_STEP_SECONDS`（既定 60）で読んで `foldToStep()` で 5 分に畳む。
畳み方はコンポーネント間のマージと同じ規則で、`0` になるのは 5 分続けて落ちたときだけ。
**`SUB_STEP_SECONDS` は k8s 側の `scrape_interval` に合わせること**
（`../k8sg1` の `docs/monitoring-external.md`、`blackbox-http` ジョブ）。
細かくしても情報は増えず、粗くすると再び取りこぼす。

**時間軸は 5 分境界に丸め、全サービスで同じ値を使う。**
サービスごとに `Date.now()` を評価すると格子がずれ、タイムラインがマージできなくなる
（旧実装の不具合。`scripts/verify-schema.js` で検証している）。

**ファイル名がスキーマ版を持つ。** 将来スキーマを変えるときは `status.v2.json` を作り、
新しいフロントエンドだけがそれを読むようにすれば、無停止で切り替えられる。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [README.md](README.md) | 概要・データ形式・設定 |
| [docs/AWS_SETUP.md](docs/AWS_SETUP.md) | AWS 側の手動セットアップ手順（Terraform 化の入力） |
| [docs/REBUILD_PLAN.md](docs/REBUILD_PLAN.md) | 作り直しの経緯と、旧実装の不具合の原因分析 |
| [SECURITY.md](SECURITY.md) | 機密情報の扱いと IAM の原則 |

## 未着手

- **Terraform 化**。構成は固まったので着手できる。
  手動で作ったリソースの設定値は `docs/AWS_SETUP.md` にある
- **旧構成の撤去**（`UpdateStatusFunction`、API Gateway の `/api/v1/status`、
  `data/status.json`、`data/messages.json`）。切り戻し先なので数日置いてから
- **ステータスの手動上書き**。旧 `/status` コマンドで出来たが未実装。
  必要なら `data/overrides.json` を Lambda 管理にして、フロントで合成する
