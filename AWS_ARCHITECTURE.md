# AWS サーバーレス構成設計書

## 📋 システム概要

このステータスページは、完全サーバーレス構成でAWS上で動作します。

- **ドメイン**: `status.highemerly.net`
- **コンテンツ配信**: CloudFront + S3
- **バックエンド**: Lambda + API Gateway
- **DNS**: Route53

---

## 🏗️ システム構成図

```
[ユーザー（ブラウザ）]
    ↓
[CloudFront (status.highemerly.net)]
    ↓
    ├─→ [S3バケット] ← HTML, JS, CSS, /data/*.json
    │                  (ブラウザが直接読み取り)
    │                  キャッシュTTL: 120秒
    │
    └─→ [API Gateway]
          └─→ POST /update-status → [Lambda: UpdateStatus]

[Discord Slash Command]
    ↓ (署名付きHTTPS POST)
[API Gateway] → POST /discord-interaction
    ↓
[Lambda: HandleDiscordInteraction]
    ↓
[S3: /data/messages.json 更新]
```

---

## ⏱️ キャッシュ・更新タイミング設計

### 重要な時間設定

| 項目 | 時間 | 理由 |
|-----|------|------|
| CloudFrontキャッシュTTL | **120秒** | キャッシュによる遅延を最小化 |
| Lambda更新判定閾値 | **3分** | Prometheusへの負荷を抑制 |
| ブラウザ更新リクエスト閾値 | **5分** | ユーザー体感とAPI呼び出しのバランス |
| ブラウザ自動リロード間隔 | **5分** | 常に最新情報を表示 |

### ステータス更新フロー

```
Time: 0:00 - 初回アクセス
  ↓
[ブラウザ] GET /data/status.json (CloudFront経由)
  ↓
lastUpdate: 0:00 → 表示

Time: 0:02 - CloudFrontキャッシュ有効期限切れ
  ↓
[次のユーザー] GET /data/status.json
  ↓
CloudFront → S3から再取得（lastUpdate: 0:00）

Time: 5:00 - 自動リロード
  ↓
[ブラウザ] GET /data/status.json
  ↓
lastUpdate: 0:00（5分以上経過）
  ↓
[ブラウザ] POST /api/update-status { lastUpdate: "0:00" }
  ↓
[Lambda] S3のstatus.jsonをチェック
  lastUpdate: 0:00（3分以上経過）
  ↓
Prometheusからデータ取得 → S3更新（lastUpdate: 5:00）
  ↓
[ブラウザ] 再度 GET /data/status.json
  ↓
新しいデータを表示
```

### 同時アクセス時の挙動

```
複数ユーザーが同時にアクセス:

User A (5:00): lastUpdate 0:00 → POST /api/update-status
  ↓
Lambda A: S3チェック → 0:00 → Prometheus取得開始...

User B (5:01): lastUpdate 0:00 → POST /api/update-status
  ↓
Lambda B: S3チェック → 0:00（まだ更新中） → Prometheus取得開始...

Lambda A: S3更新完了（5:00）
Lambda B: S3更新完了（5:01）← 最新版で上書き（問題なし）
```

**最悪ケースの遅延**: 5分（ブラウザ判定） + 2分（CloudFrontキャッシュ） = **7分**

---

## 🗂️ S3バケット構成

**バケット名**: `status-highemerly-net`

```
s3://status-highemerly-net/
├── index.html
├── _next/
│   ├── static/
│   └── ...
├── data/
│   ├── status.json        # Prometheusステータス
│   └── messages.json      # Discordメッセージ
└── config/
    └── services.json      # サービス設定（静的）
```

### /data/status.json 構造

```json
{
  "lastUpdate": "2025-11-22T12:34:56Z",
  "services": [
    {
      "id": "handon-web",
      "status": "up",
      "responseTime": 123,
      "lastChecked": "2025-11-22T12:34:56Z",
      "incidents": [],
      "history": [...]
    }
  ]
}
```

### /data/messages.json 構造

```json
{
  "messages": [
    {
      "id": "msg-12345",
      "categoryId": "handon-club",
      "content": "メンテナンスのお知らせ",
      "timestamp": "2025-11-22T12:00:00Z",
      "author": "Discord User",
      "type": "maintenance",
      "pinned": false
    }
  ]
}
```

---

## ☁️ CloudFront設定

```yaml
Distribution:
  Domain: status.highemerly.net
  Origins:
    - Id: S3Origin
      DomainName: status-highemerly-net.s3.amazonaws.com
      S3OriginConfig:
        OriginAccessIdentity: origin-access-identity/cloudfront/XXXXX

    - Id: APIGateway
      DomainName: xxxxx.execute-api.ap-northeast-1.amazonaws.com
      OriginPath: /prod
      CustomOriginConfig:
        OriginProtocolPolicy: https-only

  Behaviors:
    # 静的ファイル
    - PathPattern: /*
      TargetOrigin: S3Origin
      CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6  # CachingOptimized
      ResponseHeadersPolicyId: 60669652-455b-4ae9-85a4-c4c02393f86c  # CORS-with-preflight

      # /data/*.json のみ TTL 120秒
      CacheBehaviorSettings:
        MinTTL: 0
        DefaultTTL: 120
        MaxTTL: 120

    # API: status更新
    - PathPattern: /api/update-status
      TargetOrigin: APIGateway
      AllowedMethods: [GET, HEAD, OPTIONS, POST]
      CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad  # CachingDisabled
      OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac  # AllViewerExceptHostHeader

    # API: Discord連携
    - PathPattern: /api/discord-interaction
      TargetOrigin: APIGateway
      AllowedMethods: [POST, OPTIONS]
      CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad  # CachingDisabled

  ViewerCertificate:
    AcmCertificateArn: arn:aws:acm:us-east-1:XXXXX:certificate/XXXXX
    SslSupportMethod: sni-only
    MinimumProtocolVersion: TLSv1.2_2021
```

---

## 🔌 API Gateway設定

```yaml
Type: REST API
Name: status-page-api
Stage: prod

Resources:
  /update-status:
    POST:
      Integration: Lambda (UpdateStatusFunction)
      Request:
        Body:
          {
            "lastUpdate": "2025-11-22T12:00:00Z"
          }
      Responses:
        200:
          {
            "updated": true,
            "lastUpdate": "2025-11-22T12:34:56Z"
          }
        304:
          {
            "updated": false,
            "message": "Still fresh (less than 3 minutes old)"
          }

  /discord-interaction:
    POST:
      Integration: Lambda (HandleDiscordInteractionFunction)
      Request Headers:
        - x-signature-ed25519 (required)
        - x-signature-timestamp (required)
```

---

## ⚡ Lambda関数設計

### 1. UpdateStatusFunction

**目的**: Prometheusからデータを取得して `/data/status.json` を更新

```yaml
Runtime: Node.js 20.x
Memory: 512 MB
Timeout: 30秒
Handler: index.handler

Environment Variables:
  S3_BUCKET: status-highemerly-net
  PROMETHEUS_URL: (SSM Parameter)
  PROMETHEUS_USERNAME: (SSM Parameter)
  PROMETHEUS_PASSWORD: (SSM Parameter)
  CACHE_MAX_AGE: 180  # 3分（秒単位）

IAM Permissions:
  - s3:GetObject (status-highemerly-net/data/status.json)
  - s3:PutObject (status-highemerly-net/data/status.json)
  - ssm:GetParameter
```

**処理フロー**:

```javascript
1. S3から /data/status.json を取得
2. lastUpdate をチェック:
   - 現在時刻 - lastUpdate < 180秒 → 304 返却（更新不要）
   - 現在時刻 - lastUpdate >= 180秒 → 更新処理へ
3. config/services.json を読み込み
4. 各サービスについてPrometheusにクエリ実行（並列）
5. レスポンスをパース → status, responseTime, history 計算
6. 新しいJSONを生成（lastUpdate = 現在時刻）
7. S3に /data/status.json を上書き
8. 200 OK を返却
```

### 2. HandleDiscordInteractionFunction

**目的**: Discord Slash Commandを処理して `/data/messages.json` を更新

```yaml
Runtime: Node.js 20.x
Memory: 256 MB
Timeout: 10秒
Handler: index.handler

Environment Variables:
  S3_BUCKET: status-highemerly-net
  DISCORD_PUBLIC_KEY: (SSM Parameter)

IAM Permissions:
  - s3:GetObject (status-highemerly-net/data/messages.json)
  - s3:PutObject (status-highemerly-net/data/messages.json)
  - s3:GetObject (status-highemerly-net/config/services.json)
  - ssm:GetParameter
```

**処理フロー**:

```javascript
1. Discord署名を検証（ED25519）:
   - x-signature-ed25519 ヘッダー
   - x-signature-timestamp ヘッダー
   - 検証失敗 → 401 Unauthorized

2. Interaction Typeをチェック:
   - type=1 (PING) → { type: 1 } を返却（Discord検証）
   - type=2 (APPLICATION_COMMAND) → コマンド処理

3. Slash Commandをパース:
   - options.category (categoryId)
   - options.action (create/delete)
   - options.message (create時のみ)

4. config/services.json を読み込み → categoryId 存在確認

5. S3から /data/messages.json を取得

6. コマンド実行:
   - create: メッセージを messages 配列に追加
   - delete: categoryId が一致する全メッセージを削除

7. S3に /data/messages.json を上書き

8. Discordにレスポンス:
   {
     "type": 4,  // CHANNEL_MESSAGE_WITH_SOURCE
     "data": {
       "content": "✅ 完了しました！"
     }
   }
```

---

## 🤖 Discord Slash Command設定

### Developer Portal設定

1. **Application作成**: https://discord.com/developers/applications

2. **Slash Command登録**:

```bash
curl -X POST \
  "https://discord.com/api/v10/applications/{APPLICATION_ID}/commands" \
  -H "Authorization: Bot {BOT_TOKEN}" \
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

3. **Interactions Endpoint URL**:
```
https://status.highemerly.net/api/discord-interaction
```

### 使用例

```
/announce category:handon-club action:create message:メンテナンスのお知らせ
→ ✅ 完了しました！「はんドンクラブ / handon.club」にメッセージを追加しました

/announce category:handon-club action:delete
→ ✅ 完了しました！「はんドンクラブ / handon.club」のメッセージを削除しました
```

---

## 🌐 Route53設定

```yaml
Hosted Zone: highemerly.net

Records:
  - Name: status.highemerly.net
    Type: A
    Alias: true
    Target: CloudFront Distribution (dxxxxx.cloudfront.net)

  - Name: status.highemerly.net
    Type: AAAA
    Alias: true
    Target: CloudFront Distribution (dxxxxx.cloudfront.net)
```

---

## 🔐 セキュリティ設計

### 1. S3バケットポリシー

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAI",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity XXXXX"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::status-highemerly-net/*"
    }
  ]
}
```

### 2. Discord署名検証

```javascript
const nacl = require('tweetnacl');

function verifyDiscordSignature(body, signature, timestamp, publicKey) {
  const message = timestamp + body;
  const isValid = nacl.sign.detached.verify(
    Buffer.from(message),
    Buffer.from(signature, 'hex'),
    Buffer.from(publicKey, 'hex')
  );
  return isValid;
}
```

### 3. IAM最小権限の原則

各Lambda関数には必要最小限の権限のみを付与

---

## 📦 デプロイフロー

### 初期セットアップ

```bash
# 1. S3バケット作成
aws s3 mb s3://status-highemerly-net

# 2. 初期JSONファイル配置
echo '{"lastUpdate":"2000-01-01T00:00:00Z","services":[]}' > data/status.json
echo '{"messages":[]}' > data/messages.json

aws s3 cp data/ s3://status-highemerly-net/data/ \
  --recursive \
  --content-type "application/json" \
  --cache-control "max-age=120"

# 3. Lambda関数デプロイ（詳細は後述）

# 4. CloudFront作成

# 5. Route53レコード作成
```

### 継続的デプロイ

```bash
# フロントエンド
npm run build
aws s3 sync ./out s3://status-highemerly-net/ \
  --exclude "data/*" \
  --delete
aws cloudfront create-invalidation \
  --distribution-id XXXXX \
  --paths "/*"

# Lambda
cd lambda/update-status
npm install --production
zip -r function.zip .
aws lambda update-function-code \
  --function-name UpdateStatusFunction \
  --zip-file fileb://function.zip
```

---

## 📊 コスト試算

```
CloudFront (データ転送 1GB/月): ~$0.15
CloudFront (リクエスト 10K/月): ~$0.01
S3 (ストレージ 1GB): ~$0.023
S3 (GET リクエスト 10K/月): ~$0.004
Lambda (実行時間): 無料枠内
API Gateway (リクエスト 1K/月): ~$0.004
Route53 (ホストゾーン): $0.50
ACM証明書: 無料

合計: 約 $0.70 - $2.00/月
```

---

## 🚀 構築手順

1. **事前準備**
   - AWSアカウント
   - Route53でhighemerly.netゾーン管理
   - ACM証明書取得（us-east-1リージョン）

2. **インフラ構築** (Terraform/CDK使用推奨)
   - S3バケット
   - Lambda関数
   - API Gateway
   - CloudFront
   - Route53レコード

3. **Discord設定**
   - Slash Command登録
   - Interactions Endpoint設定

4. **初回デプロイ**
   - フロントエンドビルド & S3アップロード
   - 初期JSONファイル配置

5. **動作確認**
   - ブラウザアクセス
   - Discord Slash Command実行
