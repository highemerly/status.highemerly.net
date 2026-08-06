#!/bin/bash

# S3に初期JSONファイルを配置するスクリプト

set -e

S3_BUCKET="${S3_BUCKET:-status-highemerly-net}"

echo "=== Initializing S3 Data Files ==="
echo "S3 Bucket: $S3_BUCKET"

# 一時ディレクトリ作成
mkdir -p tmp/data

# 初期JSONファイル作成
echo '{"lastUpdate":"2000-01-01T00:00:00Z","services":[]}' > tmp/data/status.json
echo '{"messages":[]}' > tmp/data/messages.json

# S3にアップロード
echo "Uploading initial data files..."
aws s3 cp tmp/data/status.json s3://${S3_BUCKET}/data/status.json \
  --content-type "application/json" \
  --cache-control "max-age=120" \
  --region ap-northeast-1

aws s3 cp tmp/data/messages.json s3://${S3_BUCKET}/data/messages.json \
  --content-type "application/json" \
  --cache-control "max-age=120" \
  --region ap-northeast-1

# config/services.json をアップロード
echo "Uploading services config..."
aws s3 cp config/services.json s3://${S3_BUCKET}/config/services.json \
  --content-type "application/json" \
  --region ap-northeast-1

# クリーンアップ
rm -rf tmp/

echo ""
echo "=== S3 data initialization completed ==="
