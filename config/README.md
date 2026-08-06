# Config Directory

## ファイル構成

### services.json

サービス定義ファイル。**機密情報を含まない**ため、Gitコミット可能。

```json
{
  "categories": [...],    // カテゴリ一覧
  "services": [...]       // サービス一覧（Prometheusクエリ含む）
}
```

**含めてはいけない情報**:
- ❌ Prometheus認証情報（username, password）
- ❌ Prometheus URL
- ❌ Discord Webhook Secret / Public Key
- ❌ cacheMaxAge などの設定値
- ❌ その他の機密情報

**含めるべき情報**:
- ✅ カテゴリ定義（id, name, description, url）
- ✅ サービス定義（id, name, prometheusQuery, categoryId）

## 機密情報の管理

すべての機密情報はSSM Parameter Storeで管理されます。

| 情報 | 管理方法 | 配置場所 |
|------|---------|---------|
| **カテゴリ・サービス定義** | Git管理 | `config/services.json` |
| **Prometheus URL** | SSM Parameter Store | `/status-page/prometheus/url` |
| **Prometheus認証情報** | SSM Parameter Store | `/status-page/prometheus/username`, `password` |
| **Discord公開鍵** | SSM Parameter Store | `/status-page/discord/public-key` |

## セットアップ

### 初回セットアップ

1. `services.json` はすでに存在します（サービス定義のみ）
2. SSM Parameter Storeに機密情報を設定：

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

## デプロイ

### フロントエンド（S3）

`deploy-frontend.sh` が自動的に `services.json` をS3にアップロードします。

```bash
./scripts/deploy-frontend.sh
```

### Lambda関数

Lambda関数は：
1. S3の `/config/services.json` を読み取り
2. SSM Parameterから機密情報（Prometheus認証、Discord公開鍵）を取得
3. 両方を組み合わせて動作

```bash
./scripts/deploy-lambda.sh
```

## セキュリティチェック

デプロイ前にセキュリティチェックを実行：

```bash
./scripts/check-security.sh
```

このスクリプトは以下を確認します：
- `services.json` に機密情報が含まれていないか
- JSON構文が正しいか
- 必須フィールドが存在するか

## セキュリティ

- ✅ `services.json` は公開OK（機密情報なし、サービス定義のみ）
- ✅ 機密情報はすべてSSM Parameter Storeで管理
- ✅ Lambda関数のみがSSM Parameterにアクセス可能
