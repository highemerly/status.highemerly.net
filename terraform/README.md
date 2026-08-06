# Terraform でAWSインフラを構築

このディレクトリには、ステータスページのAWSインフラをTerraformで構築するための設定が含まれています。

## 前提条件

- Terraform がインストールされていること
- AWS CLI が設定されていること
- Route53 で `highemerly.net` ゾーンが管理されていること
- ACM証明書が `us-east-1` リージョンで取得されていること（CloudFront用）

## 構築手順

### 1. 変数ファイルの作成

```bash
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集して、必要な値を設定します：

```hcl
aws_region = "ap-northeast-1"
domain_name = "status.highemerly.net"
zone_id = "Z1234567890ABC"  # Route53ゾーンID
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."  # ACM証明書ARN

# Prometheus設定
prometheus_url = "https://prometheus.handon.club/"
prometheus_username = "your-username"
prometheus_password = "your-password"

# Discord設定
discord_public_key = "your-discord-public-key"
```

### 2. Terraform初期化

```bash
cd terraform
terraform init
```

### 3. プラン確認

```bash
terraform plan
```

### 4. デプロイ

```bash
terraform apply
```

### 5. 出力確認

```bash
terraform output
```

以下の情報が出力されます：
- S3バケット名
- CloudFront Distribution ID
- API Gateway URL

## リソース一覧

このTerraformで作成されるリソース：

- **S3バケット**: 静的ファイル保存用
- **CloudFront Distribution**: CDN
- **Lambda関数** x 2:
  - UpdateStatusFunction
  - HandleDiscordInteractionFunction
- **API Gateway**: REST API
- **IAM Role & Policy**: Lambda実行用
- **SSM Parameter**: 機密情報保存
- **Route53レコード**: DNSレコード

## クリーンアップ

```bash
terraform destroy
```

**注意**: S3バケット内のファイルは先に手動で削除する必要がある場合があります。
