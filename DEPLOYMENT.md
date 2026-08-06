# デプロイメントガイド

このドキュメントでは、ステータスページをAWSにデプロイする手順を説明します。

## 📋 目次

1. [事前準備](#事前準備)
2. [AWSインフラ構築](#awsインフラ構築)
3. [初期データ配置](#初期データ配置)
4. [Lambda関数デプロイ](#lambda関数デプロイ)
5. [フロントエンドデプロイ](#フロントエンドデプロイ)
6. [Discord設定](#discord設定)
7. [動作確認](#動作確認)
8. [トラブルシューティング](#トラブルシューティング)

---

## 事前準備

### 必要なツール

- AWS CLI
- Terraform
- Node.js 18+
- npm

### AWS認証情報設定

```bash
aws configure
```

### Route53ゾーンID確認

```bash
aws route53 list-hosted-zones --query "HostedZones[?Name=='highemerly.net.'].Id" --output text
```

### ACM証明書取得（us-east-1リージョン）

CloudFront用にus-east-1リージョンで証明書を取得：

```bash
aws acm request-certificate \
  --domain-name "*.highemerly.net" \
  --validation-method DNS \
  --region us-east-1
```

DNS検証を完了後、証明書ARNを控えておく。

---

## AWSインフラ構築

### 1. 変数ファイル作成

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集：

```hcl
zone_id = "Z1234567890ABC"
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."
prometheus_url = "https://prometheus.handon.club/"
prometheus_username = "your-username"
prometheus_password = "your-password"
discord_public_key = "your-discord-public-key"
```

### 2. Terraform実行

```bash
terraform init
terraform plan
terraform apply
```

作成されるリソース：
- S3バケット
- Lambda関数 x 2
- API Gateway
- CloudFront Distribution
- Route53レコード
- IAM Role & Policy
- SSM Parameter

### 3. 出力値を確認

```bash
terraform output
```

以下をメモ：
- `s3_bucket_name`
- `cloudfront_distribution_id`
- `api_gateway_url`

---

## 初期データ配置

S3に初期JSONファイルを配置：

```bash
export S3_BUCKET=status-highemerly-net

./scripts/init-s3-data.sh
```

配置されるファイル：
- `/data/status.json` - 初期ステータス
- `/data/messages.json` - 空のメッセージ
- `/config/services.json` - サービス設定

---

## Lambda関数デプロイ

Lambda関数をビルド&デプロイ：

```bash
./scripts/deploy-lambda.sh
```

このスクリプトは：
1. 各Lambda関数のnpm installを実行
2. ZIPファイルを作成
3. AWS Lambdaにアップロード

---

## フロントエンドデプロイ

Next.jsアプリをビルドしてS3にデプロイ：

```bash
export S3_BUCKET=status-highemerly-net
export CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC

./scripts/deploy-frontend.sh
```

このスクリプトは：
1. Next.jsを静的エクスポート
2. S3にアップロード
3. CloudFrontキャッシュをクリア

---

## Discord設定

### 1. Discord Application作成

1. https://discord.com/developers/applications にアクセス
2. 「New Application」をクリック
3. アプリ名を入力（例: "Status Page Bot"）

### 2. Public Key取得

General Information → Public Key をコピー

→ SSM Parameterに保存済み（Terraformで設定）

### 3. Slash Command登録

以下のコマンドを実行：

```bash
APPLICATION_ID="your-application-id"
BOT_TOKEN="your-bot-token"

curl -X POST \
  "https://discord.com/api/v10/applications/${APPLICATION_ID}/commands" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "announce",
    "description": "ステータスページにアナウンスを投稿",
    "options": [
      {
        "name": "category",
        "description": "カテゴリ",
        "type": 3,
        "required": true,
        "choices": [
          {"name": "はんドンクラブ", "value": "handon-club"},
          {"name": "ひよこスキー", "value": "hiyoko-club"},
          {"name": "Hosteka", "value": "hosteka"},
          {"name": "anypost", "value": "anypost"},
          {"name": "ドミニオン", "value": "dominion"}
        ]
      },
      {
        "name": "action",
        "description": "アクション",
        "type": 3,
        "required": true,
        "choices": [
          {"name": "メッセージ作成", "value": "create"},
          {"name": "メッセージ削除", "value": "delete"}
        ]
      },
      {
        "name": "message",
        "description": "メッセージ内容",
        "type": 3,
        "required": false
      }
    ]
  }'
```

### 4. Interactions Endpoint設定

General Information → Interactions Endpoint URL:

```
https://status.highemerly.net/api/discord-interaction
```

「Save Changes」をクリック → Discord が署名検証を実行

---

## 動作確認

### 1. ブラウザアクセス

```
https://status.highemerly.net
```

ステータスページが表示されることを確認。

### 2. ステータス更新テスト

ブラウザの開発者ツールを開き、5分待機。
自動的にステータスが更新されることを確認。

または、手動で更新リクエスト：

```bash
curl -X POST https://status.highemerly.net/api/update-status \
  -H "Content-Type: application/json" \
  -d '{"lastUpdate":"2000-01-01T00:00:00Z"}'
```

### 3. Discord連携テスト

Discordで以下を実行：

```
/announce category:handon-club action:create message:テストメッセージ
```

ステータスページにメッセージが表示されることを確認。

```
/announce category:handon-club action:delete
```

メッセージが削除されることを確認。

---

## トラブルシューティング

### Lambda関数がエラーになる

CloudWatch Logsを確認：

```bash
aws logs tail /aws/lambda/UpdateStatusFunction --follow --region ap-northeast-1
```

### CloudFrontでアクセスできない

1. CloudFront Distributionのステータスが "Deployed" か確認
2. Route53のレコードが正しいか確認
3. ACM証明書が検証済みか確認

### Discord連携が動かない

1. Lambda関数のログを確認
2. Discord Public Keyが正しいか確認
3. Interactions Endpoint URLが正しいか確認

### ステータスが更新されない

1. Lambda関数のログを確認
2. SSM ParameterにPrometheus認証情報が正しく設定されているか確認
3. Prometheusに接続できるか確認

---

## 継続的デプロイ

### Lambda関数の更新

```bash
./scripts/deploy-lambda.sh
```

### フロントエンドの更新

```bash
./scripts/deploy-frontend.sh
```

### config/services.jsonの更新

```bash
aws s3 cp config/services.json s3://status-highemerly-net/config/services.json
```

フロントエンドを再デプロイ。

---

## コスト最適化

- CloudFront の Price Class を調整
- Lambda の Memory を最適化
- S3 Lifecycle Policy で古いバージョンを削除

---

## セキュリティベストプラクティス

1. **SSM Parameter を使用**: 機密情報はSSMに保存
2. **IAM最小権限**: Lambda に必要最小限の権限のみ付与
3. **CloudFront OAI**: S3への直接アクセスを防止
4. **Discord署名検証**: 必ず検証を実装
5. **HTTPS強制**: HTTP → HTTPS リダイレクト

---

## バックアップ

定期的にS3のデータをバックアップ：

```bash
aws s3 sync s3://status-highemerly-net/data/ ./backup/data/
```
