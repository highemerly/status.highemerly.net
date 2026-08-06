# AWS Console 手動デプロイガイド

このガイドでは、TerraformやAWS CLIを使わずに、AWS Consoleのみでステータスページをデプロイする方法を説明します。

## 📋 目次

1. [事前準備](#事前準備)
2. [S3バケット作成](#s3バケット作成)
3. [IAMロール作成](#iamロール作成)
4. [SSM Parameter Store設定](#ssm-parameter-store設定)
5. [Lambda関数作成](#lambda関数作成)
6. [API Gateway作成](#api-gateway作成)
7. [フロントエンドビルド＆アップロード](#フロントエンドビルド＆アップロード)
8. [CloudFront設定](#cloudfront設定)
9. [Route53設定](#route53設定)
10. [Discord設定](#discord設定)
11. [動作確認](#動作確認)

---

## 事前準備

### 必要なもの

1. AWSアカウント
2. ドメイン名（Route53で管理）
3. Prometheusインスタンス（監視データ取得用）
4. Discord Application（Slash Command用、オプション）
5. Node.js 18+ （フロントエンドビルド用）

### 使用するAWSリージョン

- **メインリージョン**: ap-northeast-1 (東京)
- **証明書**: us-east-1 (CloudFront用)

---

## S3バケット作成

### 1. S3コンソールを開く

https://console.aws.amazon.com/s3/ にアクセス

### 2. バケットを作成

1. **「バケットを作成」**をクリック
2. **バケット名**: `status-highemerly-net`（ユニークな名前に変更してください）
3. **リージョン**: `アジアパシフィック (東京) ap-northeast-1`
4. **パブリックアクセスをブロック**: すべてチェックを入れたまま（CloudFront経由でアクセス）
5. **バケットのバージョニング**: 無効
6. **暗号化**: 有効（SSE-S3）
7. **「バケットを作成」**をクリック

### 3. フォルダ構造を作成

作成したバケット内に以下のフォルダを作成：

1. バケットを開く
2. **「フォルダを作成」**をクリック
3. フォルダ名: `data`、**「フォルダを作成」**
4. 同様に `config` フォルダも作成

### 4. 初期JSONファイルをアップロード

#### data/status.json

1. **「data」フォルダ**を開く
2. **「アップロード」**をクリック
3. ローカルに以下の内容で `status.json` を作成:

```json
{"lastUpdate":"2000-01-01T00:00:00Z","services":[]}
```

4. アップロード設定:
   - **メタデータ**: `Content-Type` = `application/json`
   - **キャッシュコントロール**: `max-age=120`

#### data/messages.json

同様に `messages.json` をアップロード:

```json
{"messages":[]}
```

#### config/services.json

1. **「config」フォルダ**を開く
2. `config/services.json` ファイルをアップロード（プロジェクトルートの `config/services.json` を使用）

---

## IAMロール作成

Lambda関数が必要な権限を持つIAMロールを作成します。

### 1. IAMコンソールを開く

https://console.aws.amazon.com/iam/ にアクセス

### 2. Lambda用ロール作成

1. **「ロール」** → **「ロールを作成」**
2. **信頼されたエンティティタイプ**: AWS サービス
3. **ユースケース**: Lambda
4. **「次へ」**をクリック

### 3. ポリシーをアタッチ

以下のポリシーを検索して選択:

1. `AWSLambdaBasicExecutionRole`（CloudWatch Logs用）
2. 「次へ」をクリック

### 4. ロール名を設定

- **ロール名**: `StatusPageLambdaRole`
- **「ロールを作成」**をクリック

### 5. カスタムポリシーを追加

1. 作成した `StatusPageLambdaRole` を開く
2. **「許可を追加」** → **「インラインポリシーを作成」**
3. **JSON**タブをクリック
4. 以下のポリシーを貼り付け:

```json
{
  "Version": "2012-10-17",
  "Statement": [
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
    },
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": [
        "arn:aws:ssm:ap-northeast-1:*:parameter/status-page/*"
      ]
    }
  ]
}
```

5. **ポリシー名**: `StatusPageS3SSMAccess`
6. **「ポリシーの作成」**をクリック

---

## SSM Parameter Store設定

機密情報をSSM Parameter Storeに保存します。

### 1. Systems Managerコンソールを開く

https://console.aws.amazon.com/systems-manager/ にアクセス

### 2. パラメータを作成

**左メニュー** → **パラメータストア** → **パラメータの作成**

#### Prometheus URL

- **名前**: `/status-page/prometheus/url`
- **説明**: Prometheus server URL
- **タイプ**: String
- **値**: `https://prometheus.handon.club/`（あなたのPrometheus URLに変更）
- **「パラメータを作成」**

#### Prometheus Username

- **名前**: `/status-page/prometheus/username`
- **タイプ**: SecureString
- **値**: （あなたのPrometheusユーザー名）
- **「パラメータを作成」**

#### Prometheus Password

- **名前**: `/status-page/prometheus/password`
- **タイプ**: SecureString
- **値**: （あなたのPrometheusパスワード）
- **「パラメータを作成」**

#### Discord Public Key（オプション）

- **名前**: `/status-page/discord/public-key`
- **タイプ**: SecureString
- **値**: （Discord ApplicationのPublic Key）
- **「パラメータを作成」**

---

## Lambda関数作成

2つのLambda関数を作成します。

### Lambda関数1: UpdateStatusFunction

#### 1. Lambdaコンソールを開く

https://console.aws.amazon.com/lambda/ にアクセス

#### 2. 関数を作成

1. **「関数の作成」**をクリック
2. **一から作成**を選択
3. **関数名**: `UpdateStatusFunction`
4. **ランタイム**: Node.js 20.x
5. **アーキテクチャ**: x86_64
6. **アクセス権限**: 既存のロールを使用
7. **既存のロール**: `StatusPageLambdaRole`
8. **「関数の作成」**をクリック

#### 3. コードをアップロード

**オプション1: ローカルでZIPを作成**

ターミナルで以下を実行:

```bash
cd lambda/update-status
npm install --production
zip -r function.zip .
```

**オプション2: AWSコンソールで直接編集**

1. Lambda関数のコードエディタに `lambda/update-status/index.js` の内容を貼り付け
2. ただし、依存関係（`@aws-sdk/client-s3`など）があるため、ZIPアップロードを推奨

**ZIPをアップロード:**

1. Lambda関数のページで **「アップロード元」** → **「.zipファイル」**
2. 作成した `function.zip` を選択
3. **「保存」**をクリック

#### 4. 環境変数を設定

1. **「設定」**タブ → **「環境変数」**
2. **「編集」**をクリック
3. 以下の環境変数を追加:

| キー | 値 |
|------|-----|
| `S3_BUCKET` | `status-highemerly-net` |
| `CACHE_MAX_AGE` | `180` |
| `AWS_REGION` | `ap-northeast-1` |

4. **「保存」**をクリック

#### 5. タイムアウト設定

1. **「設定」**タブ → **「一般設定」** → **「編集」**
2. **タイムアウト**: `30秒`
3. **メモリ**: `512 MB`
4. **「保存」**をクリック

---

### Lambda関数2: HandleDiscordInteractionFunction

同様に2つ目のLambda関数を作成します。

#### 1. 関数を作成

1. **「関数の作成」**をクリック
2. **関数名**: `HandleDiscordInteractionFunction`
3. **ランタイム**: Node.js 20.x
4. **既存のロール**: `StatusPageLambdaRole`
5. **「関数の作成」**をクリック

#### 2. コードをアップロード

```bash
cd lambda/discord-interaction
npm install --production
zip -r function.zip .
```

Lambda関数にZIPをアップロード

#### 3. 環境変数を設定

| キー | 値 |
|------|-----|
| `S3_BUCKET` | `status-highemerly-net` |
| `AWS_REGION` | `ap-northeast-1` |

#### 4. タイムアウト設定

- **タイムアウト**: `10秒`
- **メモリ**: `256 MB`

---

## API Gateway作成

Lambda関数をHTTPエンドポイントとして公開します。

### 1. API Gatewayコンソールを開く

https://console.aws.amazon.com/apigateway/ にアクセス

### 2. REST APIを作成

1. **「APIを作成」**をクリック
2. **REST API**（プライベートではない）を選択 → **「構築」**
3. **新しいAPI**を選択
4. **API名**: `status-page-api`
5. **エンドポイントタイプ**: エッジ最適化
6. **「APIの作成」**をクリック

### 3. リソースとメソッドを作成

#### /update-status エンドポイント

1. **「アクション」** → **「リソースの作成」**
2. **リソース名**: `update-status`
3. **「リソースの作成」**をクリック
4. `/update-status` を選択 → **「アクション」** → **「メソッドの作成」**
5. **POST**を選択 → チェックマーク
6. **統合タイプ**: Lambda関数
7. **Lambda関数**: `UpdateStatusFunction`
8. **「保存」**をクリック
9. **「Lambda関数に権限を追加する」**のポップアップで**「OK」**

#### CORS設定

1. `/update-status` を選択 → **「アクション」** → **「CORSの有効化」**
2. デフォルト設定のまま**「CORSを有効にして既存のCORSヘッダーを置換」**
3. **「はい、既存の値を置き換えます」**

#### /discord-interaction エンドポイント（オプション）

同様に `/discord-interaction` リソースを作成し、`HandleDiscordInteractionFunction` と統合

### 4. APIをデプロイ

1. **「アクション」** → **「APIのデプロイ」**
2. **デプロイされるステージ**: 新しいステージ
3. **ステージ名**: `prod`
4. **「デプロイ」**をクリック

### 5. APIのURLを確認

デプロイ後、**「ステージ」** → **prod** → **「URLの呼び出し」**をコピー

例: `https://abc123xyz.execute-api.ap-northeast-1.amazonaws.com/prod`

---

## フロントエンドビルド＆アップロード

### 1. ローカルでNext.jsをビルド

プロジェクトルートで以下を実行:

```bash
# AWS用の設定に切り替え
cp next.config.aws.js next.config.js

# ビルド
npm install
npm run build

# config/services.jsonをoutディレクトリにコピー
mkdir -p out/config
cp config/services.json out/config/services.json
```

### 2. ビルドファイルをS3にアップロード

#### オプション1: AWS Consoleから手動アップロード

1. S3バケット `status-highemerly-net` を開く
2. **「アップロード」**をクリック
3. `out` ディレクトリ内の全ファイルとフォルダをドラッグ＆ドロップ
   - ただし、`data` フォルダは除外（既に作成済み）
4. **「アップロード」**をクリック

#### オプション2: AWS CLIを使用（推奨だが、手動デプロイのため省略可）

```bash
aws s3 sync ./out s3://status-highemerly-net/ \
  --exclude "data/*" \
  --delete \
  --region ap-northeast-1
```

---

## CloudFront設定

S3バケットをCDN経由で配信します。

### 1. CloudFrontコンソールを開く

https://console.aws.amazon.com/cloudfront/ にアクセス

### 2. ディストリビューションを作成

1. **「ディストリビューションを作成」**をクリック

#### オリジン設定（S3）

2. **オリジンドメイン**: S3バケット `status-highemerly-net.s3.ap-northeast-1.amazonaws.com`
3. **名前**: `S3-status-highemerly-net`
4. **オリジンアクセス**: Origin Access Control settings (recommended)
5. **「新しいOACを作成」**をクリック
   - **名前**: `status-page-oac`
   - **「作成」**
6. **S3バケットポリシーを更新**: 後で実行（指示が表示されます）

#### デフォルトのキャッシュビヘイビア

7. **ビューワープロトコルポリシー**: Redirect HTTP to HTTPS
8. **許可されたHTTPメソッド**: GET, HEAD
9. **キャッシュキーとオリジンリクエスト**:
   - **キャッシュポリシー**: CachingOptimized
10. **レスポンスヘッダーポリシー**: SimpleCORS

#### 設定

11. **代替ドメイン名（CNAME）**: `status.highemerly.net`（あなたのドメインに変更）
12. **カスタムSSL証明書**: 証明書を選択（後述）
13. **デフォルトルートオブジェクト**: `index.html`
14. **「ディストリビューションを作成」**をクリック

### 3. S3バケットポリシーを更新

ディストリビューション作成後、**「S3バケットポリシーをコピー」**というメッセージが表示されます。

1. **「ポリシーをコピー」**をクリック
2. S3バケット `status-highemerly-net` を開く
3. **「アクセス許可」**タブ → **「バケットポリシー」** → **「編集」**
4. コピーしたポリシーを貼り付け
5. **「変更の保存」**をクリック

### 4. API Gateway用のオリジンを追加

1. CloudFrontディストリビューションを開く
2. **「オリジン」**タブ → **「オリジンを作成」**
3. **オリジンドメイン**: API GatewayのURL（`abc123xyz.execute-api.ap-northeast-1.amazonaws.com`）
4. **プロトコル**: HTTPS only
5. **オリジンパス**: `/prod`
6. **名前**: `APIGateway`
7. **「オリジンを作成」**

### 5. API用のビヘイビアを作成

#### /api/update-status

1. **「ビヘイビア」**タブ → **「ビヘイビアを作成」**
2. **パスパターン**: `/api/update-status`
3. **オリジン**: `APIGateway`
4. **ビューワープロトコルポリシー**: HTTPS only
5. **許可されたHTTPメソッド**: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
6. **キャッシュポリシー**: CachingDisabled
7. **オリジンリクエストポリシー**: AllViewer
8. **「ビヘイビアを作成」**

#### /api/discord-interaction（オプション）

同様に `/api/discord-interaction` のビヘイビアを作成

### 6. /data/* のキャッシュTTLを調整

1. **「ビヘイビア」**タブ → **「ビヘイビアを作成」**
2. **パスパターン**: `/data/*.json`
3. **オリジン**: `S3-status-highemerly-net`
4. **キャッシュポリシー**: カスタムキャッシュポリシーを作成
   - **名前**: `StatusDataCache`
   - **最小TTL**: 0
   - **最大TTL**: 120
   - **デフォルトTTL**: 120
5. **「ビヘイビアを作成」**

---

## ACM証明書取得（CloudFront用）

### 1. ACMコンソールを開く

**重要**: CloudFront用の証明書は **us-east-1** リージョンで作成する必要があります。

https://console.aws.amazon.com/acm/home?region=us-east-1

### 2. 証明書をリクエスト

1. **「証明書をリクエスト」**をクリック
2. **パブリック証明書をリクエスト**
3. **完全修飾ドメイン名**: `*.highemerly.net` または `status.highemerly.net`
4. **検証方法**: DNS検証
5. **「リクエスト」**をクリック

### 3. DNS検証

1. 証明書の詳細ページで**「Route 53でレコードを作成」**をクリック
2. **「レコードを作成」**をクリック
3. 数分待つと、ステータスが**「発行済み」**になります

### 4. CloudFrontに証明書を適用

1. CloudFrontディストリビューションを開く
2. **「設定」**タブ → **「編集」**
3. **カスタムSSL証明書**: 作成した証明書を選択
4. **「変更を保存」**

---

## Route53設定

### 1. Route53コンソールを開く

https://console.aws.amazon.com/route53/ にアクセス

### 2. ホストゾーンを開く

`highemerly.net` のホストゾーンを選択

### 3. Aレコードを作成

1. **「レコードを作成」**をクリック
2. **レコード名**: `status`
3. **レコードタイプ**: A
4. **エイリアス**: はい
5. **トラフィックのルーティング先**: CloudFrontディストリビューションへのエイリアス
6. **ディストリビューション**: 作成したCloudFrontディストリビューションを選択
7. **「レコードを作成」**

### 4. AAAAレコードを作成（IPv6用、オプション）

同様にAAAAレコードも作成

---

## Discord設定（オプション）

### 1. Discord Application作成

1. https://discord.com/developers/applications にアクセス
2. **「New Application」**をクリック
3. アプリ名を入力（例: "Status Page Bot"）

### 2. Public Keyを取得

**General Information** → **Public Key** をコピーして、SSM Parameter Storeに保存（既に実施済み）

### 3. Interactions Endpoint URL設定

1. **General Information** → **Interactions Endpoint URL**
2. URL: `https://status.highemerly.net/api/discord-interaction`
3. **「Save Changes」**

Discordが検証リクエストを送信するので、Lambda関数が正しく動作していることを確認してください。

### 4. Slash Commandを登録

Discord APIを使用してコマンドを登録（curlまたはPostmanを使用）:

```bash
curl -X POST \
  "https://discord.com/api/v10/applications/{APPLICATION_ID}/commands" \
  -H "Authorization: Bot {BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "announce",
    "description": "ステータスページにアナウンスを投稿",
    "options": [...]
  }'
```

詳細は `AWS_ARCHITECTURE.md` を参照してください。

---

## 動作確認

### 1. ブラウザでアクセス

`https://status.highemerly.net` にアクセスして、ステータスページが表示されることを確認。

### 2. Lambda関数のテスト

#### UpdateStatusFunction

1. Lambda関数を開く
2. **「テスト」**タブ → **「新しいイベントを作成」**
3. イベント名: `test`
4. イベントJSON:

```json
{
  "httpMethod": "POST",
  "body": "{\"lastUpdate\":\"2000-01-01T00:00:00Z\"}"
}
```

5. **「テスト」**をクリック

成功すると、`statusCode: 200` が返ってきます。

### 3. API Gatewayのテスト

curlまたはブラウザで以下を実行:

```bash
curl -X POST https://status.highemerly.net/api/update-status \
  -H "Content-Type: application/json" \
  -d '{"lastUpdate":"2000-01-01T00:00:00Z"}'
```

### 4. CloudWatch Logsを確認

Lambda関数のログを確認して、エラーがないかチェック。

---

## トラブルシューティング

### Lambda関数がタイムアウトする

- タイムアウト設定を延長（30秒→60秒）
- Prometheusへの接続を確認

### CloudFrontで403エラー

- S3バケットポリシーを確認
- Origin Access Control (OAC) が正しく設定されているか確認

### API Gatewayで502エラー

- Lambda関数のレスポンス形式を確認（statusCode、headers、bodyが必要）
- CloudWatch Logsでエラーを確認

### ステータスが更新されない

- SSM Parameter Storeの値を確認
- Lambda関数の環境変数を確認
- Prometheusに接続できるか確認（VPC設定など）

---

## 継続的な更新

### Lambda関数の更新

1. ローカルでコードを修正
2. ZIPファイルを作成
3. Lambda関数のコンソールから再アップロード

### フロントエンドの更新

1. ローカルでコードを修正
2. `npm run build`
3. `out` ディレクトリをS3にアップロード
4. CloudFrontのキャッシュを無効化（**「無効化」**タブ → パス: `/*`）

---

## コスト最適化

- CloudFrontのPrice Classを調整（北米・ヨーロッパのみに制限）
- Lambda関数のメモリを最適化（128MB-512MB）
- S3のライフサイクルポリシーで古いバージョンを削除

---

## 完了

これでAWS Consoleのみを使用したサーバーレスステータスページのデプロイが完了しました。

詳細な設計については `AWS_ARCHITECTURE.md` を参照してください。
