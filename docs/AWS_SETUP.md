# AWS 手動セットアップ手順

作り直しで新規に必要になるリソースの設定手順。
**Terraform 化するときの入力になるので、値を変えたらこのファイルも更新すること。**

前提となる既存リソース（S3 バケット・CloudFront・Route53）はそのまま流用する。

| 項目 | 値 |
|---|---|
| リージョン | `ap-northeast-1` |
| S3 バケット | `status-highemerly-net` |
| CloudFront ディストリビューション ID | <CLOUDFRONT_DISTRIBUTION_ID> |
| AWS アカウント ID | <ACCOUNT_ID> |
| GitHub リポジトリ | highemerly/status.highemerly.net |

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

**信頼ポリシー**（`<ACCOUNT_ID>` と `<OWNER>/<REPO>` を置換）:

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
          "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

> **`sub` の条件を省略したり `repo:*` にしたりしないこと。**
> 省略すると「GitHub 上の任意のリポジトリ」がこのロールを引き受けられる状態になる。
> ここでは `main` ブランチに限定している。`push` / `workflow_dispatch` /
> `repository_dispatch` はいずれもこの `sub` になるため、
> [`deploy.yml`](../.github/workflows/deploy.yml) の 3 つのトリガー全部で動く。

**アクセス許可ポリシー**（ロール名の例: `github-actions-status-page-deploy`）:

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
| `AWS_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/github-actions-status-page-deploy` |
| `S3_BUCKET` | `status-highemerly-net` |

> どちらも秘密情報ではないので Secrets ではなく Variables でよい。
> ロール ARN が漏れても、信頼ポリシーで許可したリポジトリからしか引き受けられない。

### 1-4. 動作確認

`main` に push するか、Actions タブから **Deploy** を手動実行する。
`Configure AWS credentials (OIDC)` ステップが成功すれば接続できている。

失敗する場合は次を確認する:

- `Not authorized to perform sts:AssumeRoleWithWebIdentity` → 信頼ポリシーの
  `sub` がリポジトリ名・ブランチ名と一致しているか
- `Credentials could not be loaded` → ワークフローの
  `permissions: id-token: write` があるか

---

## 2. status.json を 5 分ごとに生成する（EventBridge）

現行の「アクセス契機で生成」をやめ、スケジュール実行に変える。

### 2-1. Lambda の実行ロールに必要な権限

既存の `UpdateStatusFunction` の実行ロールに以下があることを確認する。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::status-highemerly-net/config/services.json"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::status-highemerly-net/data/*"
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:ap-northeast-1:<ACCOUNT_ID>:parameter/status-page/prometheus/*"
    },
    {
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

CloudWatch Logs への書き込みは `AWSLambdaBasicExecutionRole` で足りる。

### 2-2. Lambda の設定

| 項目 | 値 | 備考 |
|---|---|---|
| メモリ | 512 MB | Prometheus への並列リクエストが主。増やすと速くなるが無料枠を食う |
| タイムアウト | 60 秒 | 12 サービス × 2 クエリを並列実行。通常は数秒 |
| 環境変数 `S3_BUCKET` | `status-highemerly-net` | |
| 環境変数 `HISTORY_HOURS` | `48` | 履歴の保持時間 |

### 2-3. EventBridge スケジュールを作成

Amazon EventBridge → ルール → **ルールを作成**

| 項目 | 値 |
|---|---|
| 名前 | `status-page-update-5min` |
| ルールタイプ | スケジュール |
| スケジュールパターン | `rate(5 minutes)` |
| ターゲット | Lambda 関数 `UpdateStatusFunction` |

> EventBridge の**ルール**によるスケジュール実行は課金されない。
> （EventBridge **Scheduler** は 100 万回あたり $1 だが、月 8,640 回なので誤差）

### 2-4. コストの確認結果

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
| `data/status.json` | `public, max-age=60, s-maxage=60` | Lambda の `PutObject` |

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
      https://api.github.com/repos/<OWNER>/<STATUS_REPO>/dispatches \
      -d '{"event_type":"k8s-updated"}'
```

この場合、k8s リポジトリ側にステータスページリポジトリへの
Contents: Read and write 権限を持つ PAT が別途必要になる。

---

## 5. Discord Bot → GitHub Actions（案C）

> 手順 5 は「お知らせ機能の置き換え」の段階で実施する。ここは予定。

Bot は S3 にも CloudFront にも触らない。GitHub に `repository_dispatch` を送るだけ。

- GitHub で fine-grained PAT を発行（対象リポジトリのみ / Contents: Read and write）
- SSM Parameter Store に `SecureString` で保存: `/status-page/github/token`
- `DiscordCommandWorkerFunction` は**廃止**（S3 書き込みも invalidation も不要になるため）
- `HandleDiscordInteractionFunction` の実行ロールから S3 / CloudFront 権限を削除し、
  `ssm:GetParameter` on `/status-page/github/*` を追加
