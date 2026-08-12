# セキュリティガイド

## 🔐 機密情報の管理

### 概要

このプロジェクトでは、機密情報を以下の方法で管理します：

| 情報 | 管理方法 | 配置場所 |
|------|---------|---------|
| **カテゴリ・サービス定義** | Git管理（公開） | `config/services.json` |
| **Prometheus URL** | SSM Parameter Store | `/status-page/prometheus/url` |
| **Prometheus認証情報** | SSM Parameter Store | `/status-page/prometheus/username`, `password` |
| **Discord公開鍵** | SSM Parameter Store | `/status-page/discord/public-key` |

---

## 📁 config/services.json の管理

### ✅ 正しい構成（機密情報なし）

**config/services.json**:
```json
{
  "categories": [
    {
      "id": "handon-club",
      "name": "はんドンクラブ / handon.club",
      "description": "汎用Mastodonサーバー。",
      "url": "https://handon.club/"
    }
  ],
  "services": [
    {
      "id": "handon-web",
      "name": "Web",
      "prometheusQuery": "probe_http_status_code{...}",
      "categoryId": "handon-club"
    }
  ]
}
```

**含めるべき情報**:
- ✅ カテゴリ定義（id, name, description, url）
- ✅ サービス定義（id, name, prometheusQuery, categoryId）

**含めてはいけない情報**:
- ❌ Prometheus認証情報（username, password）
- ❌ Prometheus URL
- ❌ Discord関連の情報（webhookSecret, publicKey）
- ❌ cacheMaxAge などの設定値

### ❌ 間違った例（機密情報を含む）

```json
{
  "categories": [...],
  "services": [...],
  "prometheus": {
    "url": "https://prometheus.handon.club/",   ← 不要（SSMで管理）
    "auth": {
      "username": "admin",                      ← 公開される！
      "password": "secret123"                   ← 公開される！
    },
    "cacheMaxAge": 60                           ← 不要（Lambda側で管理）
  },
  "discord": {
    "webhookSecret": "webhook-secret"           ← 公開される！
  }
}
```

**問題**: このJSONはS3に公開配置され、ブラウザから誰でもアクセス可能

---

## 🔑 SSM Parameter の設定

### 必要なパラメータ

```bash
# Prometheus設定
/status-page/prometheus/url         # String
/status-page/prometheus/username    # SecureString
/status-page/prometheus/password    # SecureString

# Discord設定
/status-page/discord/public-key     # SecureString
```

### セットアップコマンド

```bash
# Prometheus URL
aws ssm put-parameter \
  --name "/status-page/prometheus/url" \
  --value "https://prometheus.handon.club/" \
  --type String \
  --region ap-northeast-1

# Prometheus ユーザー名（暗号化）
aws ssm put-parameter \
  --name "/status-page/prometheus/username" \
  --value "your-username" \
  --type SecureString \
  --region ap-northeast-1

# Prometheus パスワード（暗号化）
aws ssm put-parameter \
  --name "/status-page/prometheus/password" \
  --value "your-password" \
  --type SecureString \
  --region ap-northeast-1

# Discord公開鍵（暗号化）
aws ssm put-parameter \
  --name "/status-page/discord/public-key" \
  --value "your-discord-public-key" \
  --type SecureString \
  --region ap-northeast-1
```

### パラメータの確認

```bash
# 一覧表示
aws ssm describe-parameters \
  --parameter-filters "Key=Name,Option=BeginsWith,Values=/status-page/" \
  --region ap-northeast-1

# 値を取得（復号化）
aws ssm get-parameter \
  --name "/status-page/prometheus/username" \
  --with-decryption \
  --region ap-northeast-1
```

---

## 🛡️ Lambda IAM 権限

**関数ごとに必要な最小限だけを与える。** まとめて `parameter/status-page/*` や
`data/*` を許可しない。具体的なポリシーは
[docs/AWS_SETUP.md](docs/AWS_SETUP.md) の手順 2-1 と 5-1 にある。

| 関数 | 読む | 書く |
|---|---|---|
| `StatusPageUpdateStatus` | `config/services.json`<br>`/status-page/prometheus/*` | `data/status.v1.json` |
| `DiscordInteractionFunction` | `/status-page/discord/*` | `data/announcements.json` |

守るべき原則:

- **書き込み先はファイル単位で指定する。** `data/*` を許可すると、
  稼働状況のファイルを Discord Bot が壊せる状態になる
- **SSM は用途ごとのパスに絞る。** `/status-page/*` にすると、
  Prometheus のパスワードを Discord Bot が読めてしまう
- **ARN のアカウント ID に `*` を使わない**
- `SecureString` を読むには `ssm:GetParameter` に加えて `kms:Decrypt` が要る。
  `kms:ViaService` 条件で SSM 経由に限定する

---

## 🗂️ S3 の書き込み領域

**バケット内で書き手を 1 つに定める。**

| プレフィックス | 書く主体 |
|---|---|
| `data/` | **Lambda のみ**（稼働状況とお知らせ） |
| それ以外（`config/`, `_next/`, HTML） | **GitHub Actions のみ** |

GitHub Actions のロールには `data/` への書き込みを **Deny** で明示的に禁じてある。
`aws s3 sync --delete` が Lambda の出力を消す事故を防ぐため。

---

## ⚠️ チェックリスト

デプロイ前に以下を確認：

- [ ] `config/services.json` に機密情報が含まれていない
  - [ ] `prometheus` セクションがない
  - [ ] `discord` セクションがない
  - [ ] `auth`, `username`, `password`, `webhookSecret` フィールドがない
- [ ] SSM Parameterが全て設定されている
- [ ] Lambda IAM Roleに適切な権限がある
- [ ] S3バケットポリシーが適切（CloudFront OAIのみ許可）

### 自動チェック

セキュリティチェックスクリプトを実行：

```bash
./scripts/check-security.sh
```

---

## 🚨 インシデント対応

### 機密情報が漏洩した場合

1. **即座にパスワードを変更**
   ```bash
   # Prometheusパスワード変更
   aws ssm put-parameter \
     --name "/status-page/prometheus/password" \
     --value "new-password" \
     --type SecureString \
     --overwrite
   ```

2. **S3から機密情報を削除**
   ```bash
   # 現在のファイルを確認
   aws s3 cp s3://status-highemerly-net/config/services.json -

   # 正しいファイルで上書き
   aws s3 cp config/services.json s3://status-highemerly-net/config/services.json
   ```

3. **CloudFrontキャッシュをクリア**

   通常の更新では invalidation を使わない（`s-maxage=60` で入れ替わるため。
   常用するとコストがかかる）。ただし**漏洩時は 60 秒すら待てない**ので、
   このときは使ってよい。

   ```bash
   aws cloudfront create-invalidation \
     --distribution-id YOUR_DIST_ID \
     --paths "/config/services.json"
   ```

4. **Gitコミット履歴を確認**
   - 機密情報がコミットされていないか確認
   - 含まれている場合は `git filter-repo --replace-text` で履歴から除去する
     （`git filter-branch` は非推奨）。**このリポジトリは公開されている**ため、
     push 済みなら値そのものを無効化すること

---

## 🔍 定期監査

月次で以下を確認：

1. SSM Parameterの棚卸し
2. S3公開ファイルに機密情報がないか確認
3. Lambda CloudWatch Logsに機密情報が出力されていないか確認
4. IAM権限の最小化確認

---

## 📚 参考資料

- [AWS SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [AWS Secrets Manager vs Parameter Store](https://docs.aws.amazon.com/prescriptive-guidance/latest/patterns/store-and-manage-secrets-in-aws.html)
