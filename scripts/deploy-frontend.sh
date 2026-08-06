#!/bin/bash

# フロントエンドデプロイスクリプト

set -e

S3_BUCKET="${S3_BUCKET:-status-highemerly-net}"
CLOUDFRONT_DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID}"

echo "=== Deploying Frontend to S3 ==="
echo "S3 Bucket: $S3_BUCKET"

# 1. 静的エクスポート用の設定に切り替え
echo "Switching to AWS config..."
cp next.config.aws.js next.config.js

# 2. app/page.tsx は既にクライアント版
echo "Using client-side rendering (app/page.tsx)..."

# 3. ビルド
echo "Building Next.js app..."
npm run build

# 4. config/services.jsonをoutディレクトリにコピー
echo "Copying config files..."
mkdir -p out/config
cp config/services.json out/config/services.json

# 5. S3にアップロード（/dataディレクトリは除外）
echo "Uploading to S3..."
aws s3 sync ./out s3://${S3_BUCKET}/ \
  --exclude "data/*" \
  --delete \
  --region ap-northeast-1

# 6. CloudFrontキャッシュクリア
if [ -n "$CLOUDFRONT_DISTRIBUTION_ID" ]; then
  echo "Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id ${CLOUDFRONT_DISTRIBUTION_ID} \
    --paths "/*" \
    --region us-east-1
else
  echo "CLOUDFRONT_DISTRIBUTION_ID not set, skipping cache invalidation"
fi

# 7. 元の設定に戻す
echo "Restoring original config..."
git checkout next.config.js 2>/dev/null || true

echo ""
echo "=== Frontend deployment completed ==="
