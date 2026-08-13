# AWS 手動セットアップ手順

作り直しで新規に必要になるリソースの設定手順。
**Terraform 化するときの入力になるので、値を変えたらこのファイルも更新すること。**

前提となる既存リソース（S3 バケット・CloudFront・Route53）はそのまま流用する。

> **`<ACCOUNT_ID>` と `<CLOUDFRONT_DISTRIBUTION_ID>` は伏せてある。**
> このリポジトリは公開されているため、実値は書かない。
> 貼り付ける前に自分の値へ置換すること。
>
> | 伏せ字 | 確認先 |
> |---|---|
> | `<ACCOUNT_ID>` | AWS コンソール右上のアカウントメニュー、または `aws sts get-caller-identity` |
> | `<CLOUDFRONT_DISTRIBUTION_ID>` | CloudFront → ディストリビューション一覧 |

| 項目 | 値 |
|---|---|
| リージョン | `ap-northeast-1` |
| S3 バケット | `status-highemerly-net` |
| CloudFront ディストリビューション ID | `<CLOUDFRONT_DISTRIBUTION_ID>` |
| AWS アカウント ID | `<ACCOUNT_ID>` |
| GitHub リポジトリ | `highemerly/status.highemerly.net` |
| 新 Lambda 関数 | `StatusPageUpdateStatus` |
| 新 Lambda の ARN | `arn:aws:lambda:ap-northeast-1:<ACCOUNT_ID>:function:StatusPageUpdateStatus` |

---

## 1. GitHub Actions から AWS に OIDC で接続する

長期の IAM アクセスキーを GitHub に置かない構成にする。
GitHub が発行する短命の OIDC トークンで IAM ロールを引き受ける。

### 1-1. IAM に GitHub の ID プロバイダを登録

IAM → ID プロバイダ → **プロバイダを追加**

| 項目 | 値 |
|---|---|
| プロバイダのタイプ | OpenID Connect |
| プロバイダの URL | `https://token.actions.githubusercontent.com` |
| 対象者（Audience） | `sts.amazonaws.com` |

> 「サムプリントを取得」ボタンがある場合は押す。現在の AWS は GitHub の
> ルート CA を自動検証するため、サムプリントの値は実質的に使われない。

### 1-2. デプロイ用 IAM ロールを作成

IAM → ロール → **ロールを作成** → カスタム信頼ポリシー

**信頼ポリシー**（`<ACCOUNT_ID>` を置換して使う）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:highemerly@3039555/status.highemerly.net@1325293932:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

> **`sub` に数値が入っているのは誤記ではない。**
>
> GitHub が発行する OIDC トークンの `sub` は、所有者名とリポジトリ名に
> それぞれ**不変の数値 ID** を付けた形式になる。
>
> | 部分 | 値 | 意味 |
> |---|---|---|
> | `highemerly@3039555` | `3039555` | 所有者 ID |
> | `status.highemerly.net@1325293932` | `1325293932` | リポジトリ ID |
>
> 名前だけの `repo:highemerly/status.highemerly.net:...` では**一致せず**、
> `Not authorized to perform sts:AssumeRoleWithWebIdentity` になる。
>
> ID は名前を変えても変わらないため、**リポジトリをリネームしても
> このポリシーは壊れない**（逆に、名前ベースだと他人が旧名を取得して
> なりすませる余地があるので、ID 付きのほうが安全）。
>
> 値は `gh api repos/<owner>/<repo> -q .id` と
> `gh api users/<owner> -q .id` で確認できる。
> 実際に発行されるクレームは
> [`debug-oidc.yml`](../.github/workflows/debug-oidc.yml) を手動実行すると見られる。

> **`sub` の条件を省略したり `repo:*` にしたりしないこと。**
> 省略すると「GitHub 上の任意のリポジトリ」がこのロールを引き受けられる状態になる。
> ここでは `main` ブランチに限定している。`push` / `workflow_dispatch` /
> `repository_dispatch` はいずれもこの `sub` になるため、
> [`deploy.yml`](../.github/workflows/deploy.yml) の 3 つのトリガー全部で動く。

**アクセス許可ポリシー**（ロール名の例: `status.highemerly.net-github-role`）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::status-highemerly-net"
    },
    {
      "Sid": "ReadWriteObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::status-highemerly-net/*"
    },
    {
      "Sid": "ProtectLambdaManagedData",
      "Effect": "Deny",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::status-highemerly-net/data/*"
    }
  ]
}
```

> 最後の Deny は保険。`data/` 配下は Lambda が管理する領域で、
> Actions 側は触ってはいけない。ワークフローの `--exclude "data/*"` を
> うっかり消しても、`--delete` で `status.json` が吹き飛ぶ事故を防げる。

### 1-3. GitHub 側に変数を設定

リポジトリ → Settings → Secrets and variables → Actions → **Variables** タブ

| 名前 | 値 |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/status.highemerly.net-github-role` |
| `S3_BUCKET` | `status-highemerly-net` |

> どちらも秘密情報ではないので Secrets ではなく Variables でよい。
> ロール ARN が漏れても、信頼ポリシーで許可したリポジトリからしか引き受けられない。

### 1-4. 動作確認

`main` に push するか、Actions タブから **Deploy** を手動実行する。
`Configure AWS credentials (OIDC)` ステップが成功すれば接続できている。

失敗する場合は次を確認する:

- `Not authorized to perform sts:AssumeRoleWithWebIdentity` → 信頼ポリシーの
  `sub` がリポジトリ名・ブランチ名と一致しているか。
  トークンが持つ値は次の 1 つだけで、`push` / `workflow_dispatch` /
  `repository_dispatch` のいずれでも同じになる:

  ```
  repo:highemerly@3039555/status.highemerly.net@1325293932:ref:refs/heads/main
  ```

  > **名前だけの `repo:highemerly/status.highemerly.net:...` は一致しない。**
  > 所有者 ID とリポジトリ ID が必要（手順 1-2 の注記を参照）。
  >
  > 推測で直そうとせず、[`debug-oidc.yml`](../.github/workflows/debug-oidc.yml)
  > を手動実行して実際のクレームを見ること。生のトークンは出力しないので安全。

- `No OpenIDConnect provider found` → 手順 1-1 の ID プロバイダが未登録
- `Credentials could not be loaded` → ワークフローの
  `permissions: id-token: write` があるか

### ワークフローが「Re-run」で失敗するとき

**失敗した実行の Re-run は、当時のコミットを土台にする。** その後 `main` が
進んでいると、コミットを作っても push が弾かれる。

```
! [rejected]        main -> main (fetch first)
```

原因を直したあとは Re-run ではなく、Actions タブから
**Run workflow**（`workflow_dispatch`）で新しく実行すること。
こちらは常に最新の `main` を使う。

> [`update-versions.yml`](../.github/workflows/update-versions.yml) には
> 取り込み直して再試行する処理を入れてあるが、
> 土台が古いまま複雑な差分になった場合は素直に新規実行するほうが早い。

### デプロイが起動しないとき

[`deploy.yml`](../.github/workflows/deploy.yml) は `paths-ignore` で
`docs/**` と `**.md` を除外している。**ドキュメントだけを変更した push では
デプロイは走らない**（無駄なデプロイを避けるための意図的な設定）。

反映したいときは Actions タブから **Deploy** を手動実行する。

---

## 2. status.json を 5 分ごとに生成する（新 Lambda を新規作成）

**既存の `UpdateStatusFunction` には一切手を触れない。** 新しい関数を隣に作り、
出力先を分けたまま並行稼働させ、正しいと確認できてから切り替える。

旧 Lambda は「アクセス契機で `data/status.json` を更新する」構成のまま生かしておく。
本番のステータスページは切り替えの瞬間まで従来どおり動き続ける。

### 鍵になる考え方: ファイル名にスキーマ版を含める

**新旧で書き込み先のファイルを分ける。**

| ファイル | 書く主体 | 読む主体 |
|---|---|---|
| `data/status.json`（旧スキーマ） | 旧 Lambda | 旧フロントエンド |
| `data/status.v1.json`（新スキーマ） | **新 Lambda** | **新フロントエンド** |

こうすると **新 Lambda は `data/status.json` を一度も書かない**。
IAM ポリシーからも本番のキーを外せるので、**権限の上で本番を壊せない**。
検証中にどれだけ失敗しても、稼働中のサイトには影響が及ばない。

切り替えは**新フロントエンドをデプロイするだけ**で完了する。
Lambda 側の操作も、両者のタイミングを合わせる必要もない。

> 将来スキーマを変えるときも `status.v2.json` を作れば同じ手が使える。
> ファイル名の `v1` は、中身の `"v": 1` と一致している。

### 全体の流れ

```
[2-1〜2-3] 新ロール・新 Lambda を作る（出力先は data/status.v1.json）
     ↓
[2-4] 手動実行して検証   ← 本番に影響なし。失敗しても何も壊れない
     ↓
[2-5] EventBridge で 5 分ごとに回し、しばらく様子を見る
     ↓
[2-6] 新フロントエンドをデプロイ   ← これだけで切り替え完了
     ↓
[2-7] 旧 Lambda と API Gateway を止める（削除は数日置いてから）
```

---

### 2-1. 実行ロールを新規作成

IAM → ロール → **ロールを作成** → 信頼されたエンティティ: **AWS のサービス** → **Lambda**

ロール名の例: `status-page-update-status-role`

アクセス許可ポリシーは以下をインラインで追加する。
この Lambda が触るのは次の 3 つだけで、それ以上は与えない。

| 対象 | 操作 |
|---|---|
| `config/services.json` | 読む |
| `data/status.v1.json` | 書く |
| `/status-page/prometheus/*` | 読む（`WithDecryption: true`） |

> **`data/status.json` は含めない。** 本番が読んでいるファイルへの
> 書き込み権限を最初から与えないことで、設定ミスやコードのバグで
> 本番を壊す経路そのものを塞ぐ。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadConfig",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::status-highemerly-net/config/services.json"
    },
    {
      "Sid": "WriteStatus",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::status-highemerly-net/data/status.v1.json"
    },
    {
      "Sid": "ReadPrometheusCredentials",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:ap-northeast-1:<ACCOUNT_ID>:parameter/status-page/prometheus/*"
    },
    {
      "Sid": "DecryptSecureString",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:ViaService": "ssm.ap-northeast-1.amazonaws.com" }
      }
    }
  ]
}
```

さらに、マネージドポリシー **`AWSLambdaBasicExecutionRole`** をアタッチする
（CloudWatch Logs への書き込み用）。

`kms:Decrypt` は SSM の `SecureString` を復号するために要る。
`ssm:GetParameter` だけでは `AccessDeniedException` になる。
パラメータが `String`（平文）なら不要だが、その場合はパスワードが平文で
保存されているということなので `SecureString` に作り直すこと。

### やりがちな広げすぎ

| 書き方 | なぜまずいか |
|---|---|
| `s3:PutObject` に `config/*` を含める | Lambda が `services.json` を上書きできてしまう。設定は Actions の領域で、Lambda は読むだけ |
| `s3:GetObject` に `data/*` を含める | この Lambda は `status.json` を読まない（前回値を見ずに毎回作り直す） |
| `ssm:GetParameter` を `/status-page/*` にする | Discord 用の公開鍵や GitHub PAT まで読めてしまう。`prometheus/*` に限定する |
| ARN のアカウント ID を `*` にする | 別アカウントの同名パスまで対象に入る。自分のアカウント ID を明記する |

---

### S3 の territory（重要）

**バケット内の書き込み権限は 2 つに分ける。両者は絶対に重ならないようにする。**

| プレフィックス | 書く主体 | 内容 |
|---|---|---|
| `data/` | **Lambda のみ** | `status.v1.json` |
| それ以外（`config/`, `content/`, `_next/`, HTML） | **GitHub Actions のみ** | ビルド成果物、設定、お知らせ |

Actions 側は [手順 1-2](#1-2-デプロイ用-iam-ロールを作成) の `ProtectLambdaManagedData` で
`data/` への書き込みを Deny してある。`aws s3 sync --delete` が
`status.json` を消す事故を防ぐため。

そのため **`data/` 配下に Actions が作るファイルを置いてはいけない**。
お知らせが `content/announcements.json` に置かれているのはこのため。

### 2-2. Lambda 関数を新規作成

Lambda → **関数の作成** → 一から作成

| 項目 | 値 |
|---|---|
| 関数名 | `StatusPageUpdateStatus` |
| ランタイム | **Node.js 24.x**（`nodejs24.x`） |
| アーキテクチャ | `arm64`（x86_64 より安いが、無料枠内なのでどちらでもよい） |
| 実行ロール | 既存のロールを使用 → `status-page-update-status-role` |

> **ランタイムは `nodejs24.x` を選ぶこと。** 2026 年 8 月時点の最新。
>
> | ランタイム | 廃止予定日 |
> |---|---|
> | `nodejs24.x` | 2028-04-30 |
> | `nodejs22.x` | 2027-04-30 |
> | `nodejs20.x` | **廃止済み**（2026-04-30） |
>
> Lambda は廃止の 180 日前からメールと Health Dashboard で通知してくる。
> 通知が来たらランタイムを上げること（このコードは Node のバージョンに
> 依存する書き方をしていないので、選び直して Deploy するだけで済む）。

### 2-3. コードと設定

**この関数は外部ライブラリを一切使わない。** HTTP は Node 標準の `fetch`、
AWS SDK v3 は Node.js 24 ランタイムに同梱されているものを使う。
つまり **zip を作らず、コンソールのエディタに貼り付けるだけでよい**。

1. [`lambda/update-status/index.js`](../lambda/update-status/index.js) の中身を全部コピー
2. Lambda コンソールの「コード」タブで `index.mjs` を **`index.js` にリネーム**
   （既定は ESM の `index.mjs`。このコードは CommonJS なので拡張子を合わせる）
3. 貼り付けて **Deploy**

> `index.mjs` のまま貼ると `require is not defined` で落ちる。

> **ランタイム同梱の SDK を使うことについて**
> AWS は通常、SDK を自分でバンドルすることを推奨している（ランタイム更新で
> SDK のバージョンが変わる可能性があるため）。ただし
> **「コンソールのコードエディタで作る場合はランタイム同梱を使ってよい」**
> と明記されている。この関数が使うのは `GetObject` / `PutObject` /
> `GetParameter` だけで、API が変わる余地がほぼないため同梱で問題ない。
>
> 将来 zip でデプロイするようになったら、`lambda/update-status/package.json`
> に SDK が宣言済みなので `npm install` してから固めればよい。

**設定 → 一般設定**

| 項目 | 値 | 理由 |
|---|---|---|
| メモリ | 512 MB | Prometheus への並列リクエストが主。増やすと速いが無料枠を食う |
| タイムアウト | 60 秒 | 全サービスを並列実行。通常は数秒で終わる |

> 1 クエリあたり 48 時間 × 60 秒 = 2880 点を受け取る（5 分刻みなら 576 点だった）。
> 全サービスぶんで数 MB。512 MB / 60 秒には収まるが、サービスを増やすときは
> CloudWatch の実行時間と、`QUERY_TIMEOUT_MS`（既定 10 秒）を見ておくこと。
> 1 本でもタイムアウトするとそのサービスは 48 時間ぶん丸ごと `unknown` になる。

**設定 → 環境変数**

| キー | 値 | 備考 |
|---|---|---|
| `S3_BUCKET` | `status-highemerly-net` | 必須 |
| `HISTORY_HOURS` | `48` | 省略時は 48。履歴の保持時間 |

> `STATUS_KEY` は設定しなくてよい。既定で `data/status.v1.json` に書く。
> 別の場所に吐いて試したいときだけ使う。
>
> `SUB_STEP_SECONDS` も設定しなくてよい。既定の 60 秒は blackbox exporter の
> `scrape_interval` に合わせてある。スクレイプ間隔を変えたときだけ追随させる
> （300 の約数であること）。粗くすると 5 分内の短い障害を取りこぼす。

### 2-4. 手動実行して検証する

**ここまでは本番に一切影響しない。** 失敗しても壊れるものはない。

Lambda コンソール → **テスト** タブ → イベント JSON は `{}` でよい
（この関数はイベントの中身を見ない）→ **テスト**

**成功時のログ**（CloudWatch Logs）:

```
Wrote data/status.v1.json: 12 services, 7.5KB, 3421ms, {"up":12}
```

次に、出力された JSON を検証する。ローカルから:

```bash
curl -s https://status.highemerly.net/data/status.v1.json -o /tmp/status.json
node scripts/verify-status-json.js /tmp/status.json
```

検証内容は、5 分境界に揃っているか・履歴の長さが `points` と一致するか・
設定のサービスが全部揃っているか・`status` が履歴の末尾と矛盾しないか、など。

```
サービス 12/12 件
  handon-web         up           40ms  稼働率 100.00%
  ...
検証 OK。切り替えて問題ありません。
```

**よくある失敗**

| ログ / 症状 | 原因 |
|---|---|
| `AccessDeniedException` (ssm) | `kms:Decrypt` が無い。2-1 を確認 |
| `Prometheus URL not found at ...` | SSM のパラメータ名が違う。`/status-page/prometheus/url` |
| 全サービスが `unknown` | Prometheus に到達できていない。URL・認証・セキュリティグループ |
| 一部だけ全期間 `unknown` | そのサービスのクエリのラベルが実際と合っていない |
| `require is not defined` | ファイル名が `index.mjs` のまま。`index.js` にリネームする |
| `Task timed out` | Prometheus の応答が遅い。タイムアウトを 60 秒に上げたか確認 |

### 2-5. EventBridge スケジュールを作成

検証が通ってから作る。

Amazon EventBridge → ルール → **ルールを作成**

| 項目 | 値 |
|---|---|
| 名前 | `status-page-update-5min` |
| ルールタイプ | スケジュール |
| スケジュールパターン | `rate(5 minutes)` |
| ターゲット | Lambda 関数 **`StatusPageUpdateStatus`** |

> EventBridge の**ルール**によるスケジュール実行は課金されない。
> （EventBridge **Scheduler** は 100 万回あたり $1 だが、月 8,640 回なので誤差）

しばらく（30 分ほど）回してから、もう一度検証する。
`最終更新` が 5 分以内になっていれば cron が効いている。

```bash
curl -s https://status.highemerly.net/data/status.v1.json -o /tmp/status.json
node scripts/verify-status-json.js /tmp/status.json
```

### 2-6. 本番へ切り替える

**新フロントエンドをデプロイするだけ。** AWS 側の操作は要らない。

```bash
git checkout main
git merge rebuild
git push          # Deploy ワークフローが走る
```

新フロントエンドは `data/status.v1.json` を読む。このファイルは
2-5 の時点ですでに 5 分ごとに更新されているので、
デプロイが終わった瞬間から正しい値が表示される。

CloudFront のキャッシュは `s-maxage=60` なので、最大 60 秒で反映される。

> 旧 Lambda はまだ `data/status.json` を更新し続けているが、
> 新フロントエンドはそれを読まないので影響しない。

**切り戻し方**

```bash
git revert <マージコミット>
git push
```

これだけ。旧フロントエンドは `data/status.json`（旧 Lambda が更新中）を読むので、
そのまま元の表示に戻る。**AWS の設定を触る必要はない。**

### 2-7. 旧構成を止める

切り替えが安定してから（数日は置く）。

1. 旧 `UpdateStatusFunction` を呼んでいる **API Gateway のルート `/api/v1/status` を削除**
   - 新フロントエンドはこのエンドポイントを一切呼ばない
2. 旧 `UpdateStatusFunction` を削除
3. S3 の `data/status.json` を削除

> 3 まで済ませると切り戻し先が無くなる。1・2 を先に数日運用して、
> 問題が出ないと確信してから 3 に進むこと。

> Discord 用の Lambda（`HandleDiscordInteractionFunction` /
> `DiscordCommandWorkerFunction`）はここでは触らない。手順 5 で扱う。

### 2-8. コストの確認結果

| 項目 | 月間 | コスト |
|---|---|---|
| Lambda 実行 | 8,640 回 / 21,600 GB秒 | **$0**（無料枠 100万回・400,000 GB秒の 5%） |
| S3 PUT | 8,640 回 | 約 $0.04 |
| EventBridge ルール | 8,640 回 | $0 |

**cron 化によるコスト増はほぼゼロ。**

> **やってはいけないこと**: 更新のたびに CloudFront invalidation を打つこと。
> 8,640 パス/月 − 無料枠 1,000 パス = 7,640 × $0.005 = **月 $38**。
> 現在の総額の 20 倍になる。`Cache-Control` を短くして対応する（後述）。

---

## 3. CloudFront のキャッシュ設定

invalidation をやめ、オブジェクトごとの `Cache-Control` で制御する。

| パス | Cache-Control | 設定する場所 |
|---|---|---|
| `/_next/static/*` | `public, max-age=31536000, immutable` | [`deploy.yml`](../.github/workflows/deploy.yml) |
| HTML・`config/services.json` | `public, max-age=60, s-maxage=60` | [`deploy.yml`](../.github/workflows/deploy.yml) |
| `data/status.v1.json` | `public, max-age=60, s-maxage=60` | Lambda の `PutObject` |

CloudFront のキャッシュポリシーは、オリジンの `Cache-Control` を尊重する設定
（`CachingOptimized` など、Min TTL=0 / Default TTL=86400 / Max TTL=31536000）であればよい。
**オリジンヘッダを無視して固定 TTL を強制する設定になっていないか**だけ確認する。

> 現行の不具合の原因はここだった。`s-maxage=86400` で 24 時間持たせて
> invalidation で消す設計だったため、invalidation が失敗すると 24 時間ずれていた。

---

## 4. バージョン取得用の GitHub PAT

> AWS ではなく GitHub 側の設定。手順 5（バージョン表示）で必要。

[`update-versions.yml`](../.github/workflows/update-versions.yml) は k8s リポジトリ
（`highemerly/k8sg1-repo`）の本番マニフェストを読む。**このリポジトリは private** のため、
ワークフロー既定の `GITHUB_TOKEN` では checkout できない。

### 手順

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token
2. 次の内容で発行する

   | 項目 | 値 |
   |---|---|
   | Repository access | Only select repositories → `highemerly/k8sg1-repo` |
   | Repository permissions | **Contents: Read-only** のみ |
   | Expiration | 1 年など（期限切れでワークフローが失敗するので、更新を忘れないこと） |

3. ステータスページのリポジトリ → Settings → Secrets and variables → Actions →
   **Secrets** タブに `K8S_REPO_TOKEN` として登録する

> 権限は Contents の読み取りだけでよい。書き込みや他リポジトリへのアクセスは不要。
> `config/versions.json` の書き戻しは、ワークフロー既定の `GITHUB_TOKEN`
> （`permissions: contents: write`）で行うため、PAT に書き込み権限を与えてはいけない。

### k8s リポジトリ側から即時反映させたい場合（任意）

既定では 1 日 1 回（06:17 JST）の定期実行。イメージ更新の直後に反映したい場合は、
k8s リポジトリのワークフローから `repository_dispatch` を送る。

```yaml
- name: Notify status page
  run: |
    curl -X POST \
      -H "Authorization: Bearer ${{ secrets.STATUS_PAGE_TOKEN }}" \
      -H "Accept: application/vnd.github+json" \
      https://api.github.com/repos/highemerly/status.highemerly.net/dispatches \
      -d '{"event_type":"k8s-updated"}'
```

この場合、k8s リポジトリ側にステータスページリポジトリへの
Contents: Read and write 権限を持つ PAT が別途必要になる。

---

## 5. Discord からお知らせを投稿できるようにする

Bot が S3 の `data/announcements.json` を直接書き換える。

```
[Discord /announce] ──> [Lambda] ──> [S3: data/announcements.json]
                                            │ s-maxage=60
                                            ▼
                                     反映（1 分以内）
```

**GitHub は経由しない。** 当初は repository_dispatch でリポジトリに
ファイルを作らせる構成にしていたが、やめた。その動機は
「Bot が S3 に書くと CloudFront のキャッシュが消えない」という
旧実装の問題だったが、それは手順 3 で `s-maxage` を短くした時点で
解決している。経路が長いだけで得るものが少なかった。

`data/` は Lambda が書く領域で、GitHub Actions 側は
[手順 1-2](#1-2-デプロイ用-iam-ロールを作成) の Deny で書き込みを禁じてある。
お知らせもここに置くことで、**このファイルの書き手が Lambda 1 つに定まる**。

### 5-1. Lambda の実行ロールを整える

**なぜ触るのか。** 旧構成では、この Lambda が S3 に `messages.json` を書き、
CloudFront を invalidation し、ワーカー Lambda を呼び出していた。
新構成で必要なのは次の 2 つだけになる。

| 対象 | 操作 | 用途 |
|---|---|---|
| `/status-page/discord/public-key` | 読む | Discord の署名検証 |
| `data/announcements.json` | 読む・書く | お知らせの追加と削除 |

#### 手順

Lambda → 関数 → `DiscordInteractionFunction` →
**設定** タブ → **アクセス権限** → 実行ロールのリンク → インラインポリシーを編集 → **JSON**

中身を全部消して以下を貼る（`<ACCOUNT_ID>` は自分の値に置換）。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadDiscordPublicKey",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:GetParameters"],
      "Resource": "arn:aws:ssm:ap-northeast-1:<ACCOUNT_ID>:parameter/status-page/discord/*"
    },
    {
      "Sid": "ReadWriteAnnouncements",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::status-highemerly-net/data/announcements.json"
    },
    {
      "Sid": "DecryptSecureString",
      "Effect": "Allow",
      "Action": "kms:Decrypt",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:ViaService": "ssm.ap-northeast-1.amazonaws.com" }
      }
    }
  ]
}
```

`AWSLambdaBasicExecutionRole` は残す（CloudWatch Logs 用）。

> **`data/status.v1.json` への書き込みは含めない。** この Lambda が
> 稼働状況のファイルを触る理由はない。書けるのは
> `data/announcements.json` の 1 つだけに絞る。

> **CloudFront の権限は不要。** invalidation は使わない。
> `s-maxage=60` で 1 分以内に入れ替わる。

> `ssm:GetParameter` と `ssm:GetParameters` は末尾の `s` の有無で
> 別の IAM アクションとして扱われる。将来どちらの書き方に変えても
> 動くよう両方許可してある。

### 5-2. Lambda を差し替える

`DiscordInteractionFunction` を開く。

**この関数も外部ライブラリを使わない。** 署名検証は Node 標準の Ed25519、
AWS SDK v3 はランタイム同梱。**zip を作らずコンソールに貼るだけでよい。**

1. ランタイムを **Node.js 24.x** に変更
2. `index.mjs` を **`index.js` にリネーム**し、
   [`lambda/discord-interaction/index.js`](../lambda/discord-interaction/index.js) を貼り付け
   （リネームを忘れると `require is not defined` で落ちる）
3. 環境変数

   | キー | 値 |
   |---|---|
   | `S3_BUCKET` | `status-highemerly-net` |

4. タイムアウトを **10 秒**に

> **Discord の 3 秒制限について**
> この関数は署名検証・S3 の読み書き・応答をすべて同期で行う。
> どれも同一リージョン内で完結するため、コールドスタートを含めても収まる。
> 結果もその場で返せるので、後から書き戻す仕組みが要らない。

### 5-3. 旧ワーカーを削除する

`DiscordCommandWorkerFunction` を**削除**する。
S3 書き込みも invalidation も不要になり、担当する処理が残っていない。

`data/messages.json` も使わなくなるので削除してよい。

### 5-4. スラッシュコマンドを登録し直す

必要な値と取得元。すべて
[Discord Developer Portal](https://discord.com/developers/applications) から取る。

| 変数 | 何か | 取得元 |
|---|---|---|
| `APPLICATION_ID` | このボットのアプリケーション ID | 対象アプリ → **General Information** → Application ID |
| `BOT_TOKEN` | ボットの認証トークン | 対象アプリ → **Bot** → Token の **Reset Token** |
| `GUILD_ID` | 登録先の Discord サーバー ID | Discord でサーバー名を右クリック → **サーバー ID をコピー** |

> **`BOT_TOKEN` は認証情報。** ファイルに書かない、コミットしない。
> 発行時に一度しか表示されないので、控えていなければ Reset Token で作り直す
> （古い Token は無効になる）。
> SSM の `/status-page/discord/public-key` は別物で、
> General Information ページにある公開鍵のほう。

> **サーバー ID をコピー** が右クリックメニューに出ない場合は、
> Discord の ユーザー設定 → **詳細設定** → **開発者モード** を有効にする。

| | 反映 | 見える範囲 |
|---|---|---|
| `GUILD_ID` を指定 | **即時** | そのサーバーのみ |
| `GUILD_ID` を省略 | 最大 1 時間 | ボットが入っている全サーバー |

リポジトリのルートで実行する（`config/services.json` を読むため）。

```bash
 APPLICATION_ID=1234567890 BOT_TOKEN=xxxxx GUILD_ID=9876543210 \
   ./scripts/register-discord-command.sh
```

> 行頭に空白を 1 つ入れて実行すると、シェル履歴に残らない（bash / zsh の既定設定）。

カテゴリの選択肢は `config/services.json` から生成している。
**カテゴリを増やしたらこのスクリプトを流し直すこと。**

> 旧 `/status`（ステータスの手動上書き）は**廃止**した。
> 新構成では Prometheus の観測結果がそのまま出る。
> 不要なコマンドは `./scripts/delete-discord-commands.sh` で消せる。

### 5-5. 動作確認

```
/announce action:create title:テスト
```

1. 即座に「お知らせを公開しました。id: ...」が返る
2. **1 分以内**にサイト上部にお知らせが出る
3. `/announce action:delete id:<返ってきた id>` で消える

反応がない場合は CloudWatch Logs を見る。

| ログ | 原因 |
|---|---|
| `not authorized to perform: s3:PutObject` | 5-1 のポリシーが未適用 |
| `not authorized to perform: ssm:GetParameter` | 同上。末尾の `s` の有無も確認 |
| `invalid signature` | `/status-page/discord/public-key` が違う |
| `require is not defined` | ファイル名が `index.mjs` のまま |
| `Task timed out` | タイムアウトが 3 秒のまま。10 秒に上げる |

> お知らせは **20 件まで**保持し、超えたぶんは古いものから落ちる。
> 配信サイズを抑えるためで、通常の運用で上限に当たることはない。
