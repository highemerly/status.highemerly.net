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

Lambda関数には以下の権限が必要：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": [
        "arn:aws:ssm:ap-northeast-1:*:parameter/status-page/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::status-highemerly-net/data/*",
        "arn:aws:s3:::status-highemerly-net/config/*"
      ]
    }
  ]
}
```

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
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id YOUR_DIST_ID \
     --paths "/config/services.json"
   ```

4. **Gitコミット履歴を確認**
   - 機密情報がコミットされていないか確認
   - 含まれている場合は `git filter-branch` で削除

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
