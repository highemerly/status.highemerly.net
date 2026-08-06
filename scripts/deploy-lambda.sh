#!/bin/bash

# Lambda関数デプロイスクリプト

set -e

echo "=== Deploying Lambda Functions ==="

# 1. UpdateStatusFunction
echo ""
echo "Building UpdateStatusFunction..."
cd lambda/update-status
npm install --production
zip -r function.zip . -x "*.zip"

echo "Deploying UpdateStatusFunction..."
aws lambda update-function-code \
  --function-name UpdateStatusFunction \
  --zip-file fileb://function.zip \
  --region ap-northeast-1

rm function.zip
cd ../..

# 2. HandleDiscordInteractionFunction
echo ""
echo "Building HandleDiscordInteractionFunction..."
cd lambda/discord-interaction
npm install --production
zip -r function.zip . -x "*.zip"

echo "Deploying HandleDiscordInteractionFunction..."
aws lambda update-function-code \
  --function-name HandleDiscordInteractionFunction \
  --zip-file fileb://function.zip \
  --region ap-northeast-1

rm function.zip
cd ../..

echo ""
echo "=== Lambda deployment completed ==="
