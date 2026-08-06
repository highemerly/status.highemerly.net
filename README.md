# Simple Status Page

Prometheus + Next.js + AWS でシンプルなステータスページ

## 🌟 特徴

- **完全サーバーレス**: AWS Lambda + S3 + CloudFront で運用
- **コスト効率**: 月額 $1-2 程度
- **リアルタイム監視**: Prometheus からステータスを取得
- **Discord連携**: Slash Command でアナウンス投稿
- **レスポンシブ**: モバイルにも対応
- **自動更新**: 5分ごとにブラウザが自動リロード

---

## 📋 ドキュメント

- **[QUICKSTART_MANUAL.md](./QUICKSTART_MANUAL.md)** - AWS Console手動デプロイ（クイックスタート）
- **[MANUAL_DEPLOYMENT_GUIDE.md](./MANUAL_DEPLOYMENT_GUIDE.md)** - AWS Console手動デプロイ（詳細版）
- **[AWS_ARCHITECTURE.md](./AWS_ARCHITECTURE.md)** - システム設計の詳細
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - デプロイ手順（Terraform/AWS CLI版）
- **[SECURITY.md](./SECURITY.md)** - セキュリティと機密情報管理

---

## 🚀 クイックスタート

### 前提条件

- Node.js 18+
- AWS CLI
- Terraform
- Prometheus インスタンス

### ローカル開発（従来のNext.js SSR版）

```bash
# 依存関係インストール
npm install

# 環境変数設定
cp .env.example .env
# .env を編集

# 開発サーバー起動
npm run dev
```

ブラウザで http://localhost:3000 にアクセス

### AWSデプロイ

#### オプション1: AWS Console手動デプロイ（推奨・初心者向け）

TerraformやAWS CLIを使わず、GUIのみでデプロイ:

- **クイックスタート**: [QUICKSTART_MANUAL.md](./QUICKSTART_MANUAL.md)
- **詳細ガイド**: [MANUAL_DEPLOYMENT_GUIDE.md](./MANUAL_DEPLOYMENT_GUIDE.md)

#### オプション2: Terraform + AWS CLI（自動化）

詳細は [DEPLOYMENT.md](./DEPLOYMENT.md) を参照

```bash
# 1. Terraformでインフラ構築
cd terraform
terraform init
terraform apply

# 2. 初期データ配置
./scripts/init-s3-data.sh

# 3. Lambda関数デプロイ
./scripts/deploy-lambda.sh

# 4. フロントエンドデプロイ
./scripts/deploy-frontend.sh
```

---

## 🏗️ アーキテクチャ

```
[ユーザー] → [CloudFront] → [S3] (静的HTML/JSON)
                          ↓
                     [API Gateway] → [Lambda]
                                        ↓
                                   [Prometheus]

[Discord] → [Slash Command] → [API Gateway] → [Lambda] → [S3]
```

### 主要コンポーネント

| コンポーネント | 役割 |
|--------------|------|
| **CloudFront** | CDN、HTTPS終端 |
| **S3** | 静的ファイル、JSON保存 |
| **Lambda: UpdateStatus** | Prometheusからデータ取得 |
| **Lambda: DiscordInteraction** | Discord連携 |
| **API Gateway** | Lambda へのルーティング |
| **Route53** | DNS |

---

## ⏱️ データ更新タイミング

| 項目 | 時間 |
|-----|------|
| CloudFrontキャッシュ | 120秒 |
| Lambda更新判定 | 3分 |
| ブラウザ更新リクエスト | 5分 |
| ブラウザ自動リロード | 5分 |

ユーザーが体感する最大遅延: **7分**

---

## 🎮 Discord連携

### Slash Command

```
/announce category:handon-club action:create message:メンテナンスのお知らせ
→ カテゴリにメッセージを追加

/announce category:handon-club action:delete
→ カテゴリのメッセージを削除
```

### セキュリティ

- Discord Public Key による署名検証
- Discord側でコマンド実行権限を管理可能

---

## 📁 ディレクトリ構成

```
.
├── app/                    # Next.jsアプリ
│   ├── page.tsx           # メインページ（SSR版）
│   ├── page-client.tsx    # クライアント版（AWS用）
│   └── api/               # API Routes（ローカル開発用）
├── components/            # Reactコンポーネント
├── lib/                   # ユーティリティ
├── lambda/                # Lambda関数
│   ├── update-status/    # ステータス更新
│   └── discord-interaction/ # Discord連携
├── scripts/               # デプロイスクリプト
├── terraform/             # Terraformコード
└── config/
    └── services.json      # サービス設定
```

---

## 🔧 設定ファイル

### config/services.json

サービス定義のみを含む（**機密情報なし**）。Git管理可能。

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

### 機密情報の管理

Prometheus認証情報やDiscord公開鍵などの機密情報は、**AWS SSM Parameter Store**で管理します：

```bash
# Prometheus
/status-page/prometheus/url         # Prometheus URL
/status-page/prometheus/username    # 認証ユーザー名（暗号化）
/status-page/prometheus/password    # 認証パスワード（暗号化）

# Discord
/status-page/discord/public-key     # Discord公開鍵（暗号化）
```

詳細は [SECURITY.md](./SECURITY.md) を参照してください。

---

## 💰 コスト試算

| サービス | 月額 |
|---------|------|
| CloudFront | $0.15 - $1.00 |
| S3 | $0.02 - $0.50 |
| Lambda | 無料枠内 |
| API Gateway | $0.00 - $0.50 |
| Route53 | $0.50 |
| **合計** | **$0.70 - $2.50** |

---

## 🛠️ 開発

### ローカルテスト

```bash
npm run dev
```

### ビルド

```bash
# SSR版
npm run build

# 静的エクスポート版（AWS用）
cp next.config.aws.js next.config.js
npm run build
```

### Linting

```bash
npm run lint
```

---

## 🚢 デプロイ

### Lambda関数

```bash
./scripts/deploy-lambda.sh
```

### フロントエンド

```bash
export S3_BUCKET=status-highemerly-net
export CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC
./scripts/deploy-frontend.sh
```

---

## 🐛 トラブルシューティング

### ステータスが更新されない

1. Lambda関数のCloudWatch Logsを確認
2. Prometheus接続情報が正しいか確認
3. SSM Parameterが設定されているか確認

### Discord連携が動かない

1. Discord Public Keyが正しいか確認
2. Interactions Endpoint URLが設定されているか確認
3. Lambda関数のログを確認

詳細は [DEPLOYMENT.md](./DEPLOYMENT.md) を参照

---

## 📝 技術スタック

- **フロントエンド**: Next.js 14 + TypeScript + TailwindCSS
- **インフラ**: AWS (Lambda, S3, CloudFront, API Gateway, Route53)
- **IaC**: Terraform
- **データソース**: Prometheus
- **通知**: Discord Slash Commands

---

## 📝 ライセンス

MIT

---

## 👤 Author

はん (highemerly)
