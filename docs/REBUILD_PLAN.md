# 作り直し計画

現行実装（コミット `a5e94ae`）の調査結果と、新アーキテクチャの設計。

---

## 1. 既存実装の不具合と原因

報告された症状について、コードから原因を特定した。

### 1-1. Discord のスラッシュコマンドに反応しないことがある

**原因: Lambda の fire-and-forget パターン**

[`lambda/discord-interaction/index.js:107`](../lambda/discord-interaction/index.js#L107)

```js
invokeWorkerLambda(interaction, commandName)   // ← await していない
  .then(...)
  .catch(...);

return { ... DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE };  // 即座に return
```

Lambda はハンドラが return した瞬間に実行環境を**凍結**する。await されていない Promise
（ここでは worker Lambda を起動する SDK 呼び出し）は、まだ送信が完了していなければ
そのまま凍結され、**二度と実行されない**。

タイミング依存なので「反応するときとしないときがある」という症状に一致する。
コールドスタート時や、SDK の初回接続確立が挟まるときに落ちやすい。

**対策**: `await invokeWorkerLambda(...)` してから return する。非同期 Invoke
（`InvocationType: 'Event'`）は 10〜30ms 程度で返るため、Discord の 3 秒制限には十分間に合う。

### 1-2. CloudFront のキャッシュが消えない

**原因: `s-maxage=86400` と invalidation への依存**

[`lambda/discord-worker/index.js:279`](../lambda/discord-worker/index.js#L279)

```js
CacheControl: 'max-age=30, s-maxage=86400'   // CloudFront は 24 時間キャッシュ
```

CloudFront に 24 時間持たせておいて、毎回 invalidation で消す設計になっている。
つまり **invalidation が 1 回でも失敗すると 24 時間ずれる**。しかも失敗は握り潰されている
（[`index.js:60-62`](../lambda/discord-worker/index.js#L60-L62) の catch でログのみ）。

さらに `CreateInvalidation` は**リクエストを受け付けた時点で返る非同期 API** で、
実際の反映には数十秒〜数分かかる。ログの `invalidation completed` は完了を意味しない。

**対策**: invalidation をやめ、`s-maxage` を短く（60秒程度）する。後述のコスト面でも重要。

### 1-3. タイムラインが 5 分単位で表示されないことがある

**原因は 2 つある。**

**(a) サービスごとに時間軸の基準がずれる**

[`lambda/update-status/index.js:352`](../lambda/update-status/index.js#L352)

```js
async function fetchStatusHistory(config, service) {
  const now = Math.floor(Date.now() / 1000);      // ← サービスごとに評価される
  const threeHoursAgo = now - (3 * 60 * 60);
```

`fetchStatusHistory` はサービスごとに呼ばれ、そのたびに `Date.now()` を評価する。
12 サービスを並列で叩くので、各サービスの `now` が数ミリ秒〜数秒ずつずれる。

Prometheus の `query_range` は **`start` を基点に `step` を刻む**ため、基点がずれると
返ってくるタイムスタンプの格子もサービスごとにずれる。結果、`12:00:00, 12:05:00...` ではなく
`12:03:47, 12:08:47...` のような半端な値になり、しかもサービス間で一致しない。
マージしようとしても軸が合わないので、5 分単位に揃わない。

**(b) 複数コンポーネントのサービスで、1 つ目のクエリしか見ていない**

[`lambda/update-status/index.js:356-358`](../lambda/update-status/index.js#L356-L358)

```js
const query = Array.isArray(service.prometheusQuery)
  ? service.prometheusQuery[0]      // ← 配列でも先頭だけ
  : service.prometheusQuery;
```

現在値（`fetchServiceStatus`）は全クエリを実行してマージしているのに、履歴は先頭 1 本だけ。
「マージしたタイムライン」は実際にはマージされていない。

**対策**: `end` を 5 分境界に丸めて（`Math.floor(now / 300) * 300`）**一度だけ計算し、
全サービスに同じ値を渡す**。履歴も全クエリ分を取得してマージする。

### 1-4. 【未報告】ステータスのマージロジックが逆

[`lambda/update-status/index.js:309-315`](../lambda/update-status/index.js#L309-L315)

```js
function mergeStatuses(statuses) {
  if (statuses.length === 0) return 'unknown';
  if (statuses.some(s => s === 'up')) return 'up';    // ← 1 つでも up なら up
  ...
}
```

「1 つでも up なら全体が up」になっている。はんドンクラブで Streaming が落ちていても
Web が生きていれば **`up` と表示される**。障害が隠れる。

正しくは「全部 up なら up / 一部だけ up なら degraded / 全部 down なら down」。

なお `'degraded'` は現状どこからも生成されない（`parsePrometheusResult` は up/down/unknown しか返さない）
ため、degraded 判定はこのマージ処理でしか発生し得ない。

### 1-5. 【未報告】設定ミス

[`config/services.json:68`](../config/services.json#L68) の `hiyoko-web` の
`prometheusQuery` が `endpoint='media'` になっている（`hiyoko-media` と同じ）。
`endpoint='web'` の誤りと思われる。

---

## 2. JSON の肥大化について

### 現状

`status.json` は 3 時間分（36 点）の履歴を、サービスごとにこの形式で持っている:

```json
{
  "timestamp": "2026-08-06T12:00:00.000Z",
  "status": "up",
  "value": 200
}
```

1 点あたり約 110 バイト（`JSON.stringify(status, null, 2)` の**整形出力**なのでインデント込み）。
36 点 × 12 サービス ≒ **50KB**。

**48 時間対応にすると 576 点 × 12 サービス ≒ 800KB** になり、そのままでは使えない。

### 対策: 履歴を文字列にエンコードする

時刻が等間隔（5 分固定）なら、各点にタイムスタンプを持たせる必要はない。
**始点と step だけ持ち、状態は 1 文字で表す**。

```json
{
  "v": 1,
  "updatedAt": "2026-08-06T12:00:00Z",
  "step": 300,
  "from": "2026-08-04T12:05:00Z",
  "services": {
    "handon-web": { "status": "up", "ms": 142, "h": "111111110011111..." },
    "handon-streaming": { "status": "up", "ms": 88, "h": "111111111111111..." }
  }
}
```

`h` は 1 文字 = 1 点（`1`=up / `0`=down / `d`=degraded / `-`=unknown）。

実測値（12 サービス、`scripts/verify-schema.js` で計測）:

| | 現状(3h) | 現状形式で48h | 新形式で48h |
|---|---|---|---|
| サイズ | 53.3KB | 819.0KB | **7.5KB** |

**削減率 99.1%。** 48 時間分を持っても、現状の 3 時間分より 7 倍小さい。

さらに:

- **整形出力をやめる**（`JSON.stringify(x)`）だけでも 3 割減る
- 常に空の `incidents: []` を廃止
- `lastChecked` はサービスごとに持たず、トップレベルの `updatedAt` に集約
- 配列 + `id` フィールドをやめ、id をキーにしたオブジェクトにする

### 表示期間の切り替えが「タダ」になる

48 時間分が 8KB なら**全部を 1 ファイルで配れる**。
1h / 3h / 12h / 24h / 48h の切り替えは、フロントエンドで文字列の末尾を
`h.slice(-12)` のように切るだけ。追加のリクエストもファイルも要らない。

---

## 3. 新アーキテクチャ

```
[GitHub リポジトリ]
   │ push
   ▼
[GitHub Actions] ──build──> [S3] ──> [CloudFront] ──> [ユーザー]
   │                          ▲
   │                          │ 5分ごとに status.json を書く
   │                     [Lambda: update-status]
   │                          ▲
   │                    [EventBridge cron(5分)]
   │                          │
   │                     [Prometheus]
   │
   └──定期実行──> [k8s リポジトリを読んで versions.json 生成]
```

### 変更点

| | 現行 | 新 |
|---|---|---|
| デプロイ | 手元から `deploy-frontend.sh` | GitHub Actions（push で自動 sync） |
| status.json 生成 | **アクセス契機**（フロントが古さを判定して API を叩く） | EventBridge cron 5 分 |
| API Gateway | 必要 | **不要**（フロントは S3 の静的 JSON を読むだけ） |
| キャッシュ制御 | invalidation 依存 | `s-maxage` を短くして invalidation 廃止 |
| 履歴 | 3 時間・冗長形式 | 48 時間・圧縮形式 |

**アクセス契機をやめる副次効果として、API Gateway と `/api/v1/status` 経路が丸ごと消える。**
フロントエンドは CloudFront 上の静的 JSON を fetch するだけになり、
[`app/page.tsx:52-90`](../app/page.tsx#L52-L90) にある「古さを判定して更新をリクエストする」
複雑なロジックが不要になる。

### AWS 認証は OIDC で

GitHub Actions に長期の IAM アクセスキーを置かない。
GitHub の OIDC プロバイダを IAM に登録し、リポジトリを条件にした AssumeRole にする。
シークレットの漏洩・ローテーション問題がなくなる。

---

## 4. コスト試算

### Lambda を 5 分 cron で回す場合

- 実行回数: 12 回/時 × 24 × 30 = **8,640 回/月**
- Lambda 無料枠: 100 万リクエスト/月 + 400,000 GB秒/月（**無期限**）
- メモリ 512MB・実行 5 秒と仮定: 8,640 × 5 × 0.5 = **21,600 GB秒**

→ **無料枠の 5% 程度。実質 $0。**

EventBridge のスケジュールルールも、S3 の PUT（8,640 回 ≒ $0.04）も誤差。
**cron 化によるコスト増はほぼ考えなくてよい。**

### ただし CloudFront invalidation は要注意

もし「5 分ごとに更新したから invalidation」をやると:

- invalidation パス数: 8,640 パス/月
- 無料枠: 1,000 パス/月、超過分 **$0.005/パス**
- 7,640 × $0.005 = **月 $38**

**現在の総コスト（$1〜2）の 20 倍**。これは避ける。

**対策: invalidation を使わず、`Cache-Control: max-age=60, s-maxage=60` にする。**
5 分ごとの更新に対して 60 秒キャッシュなら十分で、コストはゼロ。
「キャッシュが消えない」問題（1-2）もこれで根本的に解決する。

なお HTML/JS/CSS 側は、ファイル名にハッシュが付く前提で長期キャッシュ（`max-age=31536000, immutable`）、
`index.html` だけ短命にするのが定石。ここも invalidation は不要になる。

---

## 5. お知らせ機能 【決定: 案C】

お知らせの**正**は Git リポジトリの `content/announcements/*.md` に置く。
Discord Bot は「投稿手段のひとつ」に降格させ、S3 を直接書かせない。

```
[Discord /announce] ──> [Lambda] ──repository_dispatch──> [GitHub Actions]
                                                                │
[GitHub Web UI で直接編集] ──push──────────────────────────────>│
                                                                ▼
                                                    [ビルド] ──> [S3]
```

**この構成の要点は、Discord Bot が S3 にも CloudFront にも触らなくなること。**
Bot の役割は「GitHub に POST する」だけになり、1-2 の invalidation 問題は
Bot の責務から完全に消える。Bot が落ちていても GitHub から投稿できる。

残る Lambda は 1 本（`discord-interaction`）のみ。`discord-worker` は廃止する。
S3 書き込み・CloudFront invalidation・`messages.json` の読み書きが全部不要になるため、
worker が担っていた処理はすべて Actions 側に移る。

1-1 の `await` 漏れは修正必須（`repository_dispatch` の POST を await する）。

### メリット / 残る課題

- ✅ 障害時にスマホの Discord から即投稿できる（速さを維持）
- ✅ 履歴・巻き戻し・レビューが git で効く
- ✅ Bot が壊れても GitHub Web UI という代替経路がある
- ❌ 反映まで Actions のビルド + sync で 1〜2 分かかる（Bot 経由でも同じ）
- ❌ Lambda に GitHub の PAT（`repository_dispatch` 権限）を持たせる必要がある
  → SSM Parameter Store に暗号化して保存。fine-grained PAT で対象リポジトリと
    Contents 権限のみに絞る

---

## 6. バージョン / リリースノート表示 【実装済み】

### k8s リポジトリの調査結果

`highemerly/k8sg1-repo`（**private**）。素の manifest + Kustomize で、
`manifests/<サービス>/<prd|dev>/*.yaml` に本番と開発が分かれている。

イメージは `image: ghcr.io/highemerly/mastodon:4.6.4-20260730131238` の形式で直接書かれており、
Kustomize の `images:` による差し替えは使っていない。**タグは manifest を読むだけで取れる。**

`redis:8.2-alpine` や `busybox:1.36` のような基盤コンテナも同じファイルに含まれるため、
全 `image:` 行を拾うのではなく、**カテゴリごとに対象を明示的に宣言する**方式にした
（`config/services.json` の `categories[].version`）。

### リリースノートの取得可否

**取得できるのは Mastodon と Misskey だけだった。**

| カテゴリ | イメージタグ | リリースノート |
|---|---|---|
| はんドンクラブ | `mastodon:4.6.4-20260730131238` | ✅ `mastodon/mastodon` の `v4.6.4` |
| ひよこスキー | `misskey/misskey:2026.6.0` | ✅ `misskey-dev/misskey` の `2026.6.0` |
| SHAMEZO | `movapic-neo:1.4.3` | ❌ リポジトリは公開だが該当タグのリリースなし |
| Hosteka | `hosteka:1.4.13` | ❌ リポジトリが private・リリース 0 件 |
| anypost | `anypost-web:2026-05-19` | ❌ `anypost-web` が private |
| ふつうのドミニオンセレクタ | `dominion:2026052601` | ❌ リポジトリが private・リリース 0 件 |

そのため **バージョンは全カテゴリで表示し、リリースノートはリンクが取れたものだけ出す**
設計にした。自作サービス側で GitHub Releases を切るようにすれば、設定を変えずに自動で出る。

はんドンクラブは独自ビルドのため、タグに `-20260730131238` というビルド時刻が付く。
`displayPattern` で `4.6.4` を抜き出し、本家のリリース（`v4.6.4`）に対応付けている。
実際のイメージタグはツールチップで確認できる。

### 更新の流れ

```
[k8s リポジトリ] --(任意) repository_dispatch--> [update-versions ワークフロー]
                                                        │ 日次 cron でも起動
                                                        ▼
                                            config/versions.json をコミット
                                                        │ push
                                                        ▼
                                              [deploy ワークフロー] --> S3
```

S3 に直接書かず**リポジトリにコミットする**ことで、デプロイ経路が 1 本にまとまり、
どのサービスがいつ上がったかが git 履歴に残る。

> **注意点**: 生成物に毎回現在時刻を入れると、バージョンが変わっていなくても
> 差分が出て、日次実行のたびに無意味なコミットとデプロイが走る。
> `scripts/build-versions.js` は内容が同じなら `updatedAt` を据え置く。

---

## 7. 進め方（推奨順序）

作り直しといっても全部を同時には変えない。**壊れたら原因が分かる粒度**で刻む。

| # | 内容 | 理由 |
|---|---|---|
| 1 | GitHub リポジトリ作成 + Actions で S3 sync（OIDC） | 以降の全変更の土台。まずデプロイ経路を確立する |
| 2 | `status.json` の新スキーマ策定 + Lambda を cron 化 | フロントの前にデータ形式を固める。1-3/1-4 のバグもここで直す |
| 3 | フロントエンド刷新（デザイン・日英・ダークモード・期間切替） | 新スキーマの上に載せる。一番量が多い |
| 4 | お知らせ機能の置き換え（案C） | 1 のデプロイ経路が前提 |
| 5 | バージョン / リリースノート | 独立した追加機能。最後でよい |

**1 と 2 の順序が重要**: 先にフロントを作ると、データ形式が変わるたびに作り直しになる。

### インフラ管理 【決定: まず手動、あとで Terraform 化】

新規に必要なリソース（GitHub OIDC プロバイダ、Actions 用 IAM ロール、
EventBridge スケジュール）は AWS Console で手動作成し、手順を
[`docs/AWS_SETUP.md`](./AWS_SETUP.md) に記録する。

構成が固まった段階（目安: 手順 3 完了後）で Terraform に移す。
既存の `terraform/` は `variables.tf` と例ファイルしか残っておらず動作しないため、
Terraform 化の際は書き直しになる。

> **後回しにするリスク**: 手動構築は「動いているが誰も再現できない」状態を生みやすい。
> これを避けるため、手動で作ったリソースは必ず `AWS_SETUP.md` に
> **スクリーンショットではなく設定値のテキスト**で残す。Terraform 化のときの入力になる。

古いドキュメント（`MANUAL_DEPLOYMENT_GUIDE.md`, `QUICKSTART_MANUAL.md`,
`DEPLOYMENT.md`, `AWS_ARCHITECTURE.md`）は現状すでに実態とずれている
（実在しない `app/page-client.tsx`, `app/api/`, `terraform/main.tf` を参照している）。
新アーキテクチャ確定後に統廃合する。
