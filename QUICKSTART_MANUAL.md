# クイックスタートガイド（AWS Console手動デプロイ）

このガイドでは、AWS Consoleを使用して最短でステータスページをデプロイする手順を説明します。

## 📋 概要

このプロジェクトは、以下のAWSサーバーレスリソースで構成されています：

```
ユーザー
  ↓ HTTPS
CloudFront (CDN)
  ├─→ S3 (静的ファイル + JSON)
  └─→ API Gateway
       └─→ Lambda関数 x 2
            ├─→ SSM (機密情報)
            └─→ Prometheus (監視データ)
```

## 🚀 5ステップでデプロイ

### ステップ1: S3バケット作成とファイルアップロード

1. **S3コンソール**を開く: https://console.aws.amazon.com/s3/
2. **「バケットを作成」**
   - バケット名: `status-highemerly-net`（ユニークな名前に変更）
   - リージョン: `ap-northeast-1` (東京)
   - パブリックアクセス: **すべてブロック**
3. バケット内に`data`と`config`フォルダを作成
4. 以下のファイルをアップロード:
   - `data/status.json`: `{"lastUpdate":"2000-01-01T00:00:00Z","services":[]}`
   - `data/messages.json`: `{"messages":[]}`
   - `config/services.json`: プロジェクトの`config/services.json`をアップロード

### ステップ2: IAMロール作成

1. **IAMコンソール**を開く: https://console.aws.amazon.com/iam/
2. **「ロール」** → **「ロールを作成」**
3. **信頼されたエンティティ**: AWS サービス → Lambda
4. ポリシーをアタッチ:
   - `AWSLambdaBasicExecutionRole`
5. ロール名: `StatusPageLambdaRole`
6. **インラインポリシーを追加**（S3とSSMへのアクセス）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::status-highemerly-net/*"
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:ap-northeast-1:*:parameter/status-page/*"
    }
  ]
}
```

### ステップ3: SSM Parameter Storeに機密情報を保存

1. **Systems Managerコンソール**を開く: https://console.aws.amazon.com/systems-manager/
2. **パラメータストア** → **パラメータの作成**
3. 以下のパラメータを作成:

| 名前 | タイプ | 値 |
|------|--------|-----|
| `/status-page/prometheus/url` | String | `https://your-prometheus-url/` |
| `/status-page/prometheus/username` | SecureString | （あなたのユーザー名） |
| `/status-page/prometheus/password` | SecureString | （あなたのパスワード） |

### ステップ4: Lambda関数を作成

#### 4-1. UpdateStatusFunction

1. **Lambdaコンソール**を開く: https://console.aws.amazon.com/lambda/
2. **「関数の作成」**
   - 関数名: `UpdateStatusFunction`
   - ランタイム: Node.js 20.x
   - ロール: `StatusPageLambdaRole`（既存のロール）
3. **コードをアップロード**:
   ```bash
   cd lambda/update-status
   npm install --production
   zip -r function.zip .
   ```
   Lambda関数で **「アップロード元」** → **「.zipファイル」** → `function.zip`
4. **環境変数を設定**:
   - `S3_BUCKET`: `status-highemerly-net`
   - `CACHE_MAX_AGE`: `180`
5. **設定**:
   - タイムアウト: `30秒`
   - メモリ: `512 MB`

#### 4-2. HandleDiscordInteractionFunction（オプション）

同様に2つ目のLambda関数を作成:
- 関数名: `HandleDiscordInteractionFunction`
- コード: `lambda/discord-interaction`
- タイムアウト: `10秒`
- メモリ: `256 MB`

### ステップ5: API Gateway + CloudFront + Route53

#### API Gateway

1. **API Gatewayコンソール**を開く: https://console.aws.amazon.com/apigateway/
2. **REST API**を作成
   - API名: `status-page-api`
3. リソース`/update-status`を作成 → POSTメソッド → `UpdateStatusFunction`と統合
4. **CORSを有効化**
5. **APIをデプロイ** → ステージ名: `prod`
6. URLをメモ: `https://xxxxx.execute-api.ap-northeast-1.amazonaws.com/prod`

#### フロントエンドビルド

```bash
# プロジェクトルートで実行
cp next.config.aws.js next.config.js
npm install
npm run build
mkdir -p out/config
cp config/services.json out/config/services.json
```

#### S3にアップロード

`out`ディレクトリ内の全ファイルをS3バケット `status-highemerly-net` にアップロード（`data`フォルダは除く）

#### ACM証明書（us-east-1で作成）

1. **ACMコンソール**（**us-east-1**）: https://console.aws.amazon.com/acm/home?region=us-east-1
2. 証明書をリクエスト: `*.highemerly.net` または `status.highemerly.net`
3. DNS検証 → Route53で自動レコード作成

#### CloudFront

1. **CloudFrontコンソール**を開く: https://console.aws.amazon.com/cloudfront/
2. **ディストリビューションを作成**
   - **オリジン1 (S3)**: `status-highemerly-net.s3.ap-northeast-1.amazonaws.com`
     - Origin Access Control (OAC)を作成
   - **オリジン2 (API Gateway)**: `xxxxx.execute-api.ap-northeast-1.amazonaws.com`
     - オリジンパス: `/prod`
3. **ビヘイビア**:
   - デフォルト: S3オリジン
   - `/api/update-status`: API Gatewayオリジン（キャッシュ無効）
4. **設定**:
   - 代替ドメイン名: `status.highemerly.net`
   - SSL証明書: 作成したACM証明書
   - デフォルトルートオブジェクト: `index.html`
5. S3バケットポリシーを更新（CloudFrontが表示する指示に従う）

#### Route53

1. **Route53コンソール**を開く: https://console.aws.amazon.com/route53/
2. ホストゾーン `highemerly.net` を開く
3. **Aレコード**を作成:
   - レコード名: `status`
   - タイプ: A
   - エイリアス: CloudFrontディストリビューション

## ✅ 動作確認

1. ブラウザで `https://status.highemerly.net` にアクセス
2. ステータスページが表示されることを確認
3. 5分待つと自動的にステータスが更新される

## 🔧 トラブルシューティング

### Lambda関数のテスト

1. Lambda関数を開く → **「テスト」**タブ
2. テストイベント:
   ```json
   {
     "httpMethod": "POST",
     "body": "{\"lastUpdate\":\"2000-01-01T00:00:00Z\"}"
   }
   ```
3. 実行 → `statusCode: 200` が返ってくることを確認

### CloudWatch Logsでエラー確認

Lambda関数の **「モニタリング」**タブ → **「CloudWatch でログを表示」**

### よくあるエラー

| エラー | 原因 | 解決方法 |
|--------|------|----------|
| 403 Forbidden (CloudFront) | S3バケットポリシーが未設定 | OACのポリシーをS3にコピー |
| 502 Bad Gateway (API Gateway) | Lambdaのレスポンス形式が不正 | statusCode, headers, bodyを確認 |
| タイムアウト | Prometheusへの接続失敗 | SSM Parameterの値を確認 |

## 📚 詳細ドキュメント

- **詳細な手順**: [MANUAL_DEPLOYMENT_GUIDE.md](./MANUAL_DEPLOYMENT_GUIDE.md)
- **アーキテクチャ**: [AWS_ARCHITECTURE.md](./AWS_ARCHITECTURE.md)
- **セキュリティ**: [SECURITY.md](./SECURITY.md)

## 📝 更新方法

### Lambda関数の更新

1. コードを修正
2. `npm install --production && zip -r function.zip .`
3. Lambda関数で **「アップロード元」** → **「.zipファイル」**

### フロントエンドの更新

1. コードを修正
2. `npm run build`
3. `out` ディレクトリをS3にアップロード
4. CloudFront → **「無効化」**タブ → パス: `/*`

---

これで完了です。
