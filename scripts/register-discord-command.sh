#!/bin/bash

# Discord Slash Commandを登録するスクリプト

set -e

# 環境変数の確認
if [ -z "$APPLICATION_ID" ]; then
  echo "Error: APPLICATION_ID environment variable is not set"
  echo "Usage: APPLICATION_ID=xxx BOT_TOKEN=xxx GUILD_ID=xxx ./scripts/register-discord-command.sh"
  exit 1
fi

if [ -z "$BOT_TOKEN" ]; then
  echo "Error: BOT_TOKEN environment variable is not set"
  echo "Usage: APPLICATION_ID=xxx BOT_TOKEN=xxx GUILD_ID=xxx ./scripts/register-discord-command.sh"
  exit 1
fi

# GUILD_IDが指定されていればギルド固有コマンド、なければグローバルコマンド
if [ -n "$GUILD_ID" ]; then
  ENDPOINT="https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands"
  echo "Registering guild-specific command for guild ${GUILD_ID}..."
else
  ENDPOINT="https://discord.com/api/v10/applications/${APPLICATION_ID}/commands"
  echo "Registering global command (may take up to 1 hour to propagate)..."
fi

# config/services.jsonからカテゴリを読み込んで選択肢を生成
if [ ! -f "config/services.json" ]; then
  echo "Error: config/services.json not found"
  exit 1
fi

# jqがインストールされているか確認
if ! command -v jq &> /dev/null; then
  echo "Error: jq is not installed. Please install jq to use this script."
  echo "  macOS: brew install jq"
  echo "  Ubuntu/Debian: apt-get install jq"
  exit 1
fi

# カテゴリの選択肢をjqで生成
CHOICES=$(jq -c '[.categories[] | {name: .name, value: .id}]' config/services.json)

echo ""
echo "=== Registering /announce command ==="
# /announce コマンドを登録
RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"announce\",
    \"description\": \"ステータスページにメッセージを追加/削除\",
    \"options\": [
      {
        \"name\": \"category\",
        \"description\": \"カテゴリを選択\",
        \"type\": 3,
        \"required\": true,
        \"choices\": ${CHOICES}
      },
      {
        \"name\": \"action\",
        \"description\": \"アクション (create/delete)\",
        \"type\": 3,
        \"required\": true,
        \"choices\": [
          {\"name\": \"create\", \"value\": \"create\"},
          {\"name\": \"delete\", \"value\": \"delete\"}
        ]
      },
      {
        \"name\": \"message\",
        \"description\": \"メッセージ内容 (createの場合のみ)\",
        \"type\": 3,
        \"required\": false
      }
    ]
  }")

# レスポンスを確認
if echo "$RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
  echo "✅ /announce command registered successfully!"
  echo "$RESPONSE" | jq '.'
else
  echo "❌ Failed to register /announce command"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo ""
echo "=== Registering /status command ==="
# /status コマンドを登録
RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"status\",
    \"description\": \"カテゴリのステータスを強制的に変更\",
    \"options\": [
      {
        \"name\": \"category\",
        \"description\": \"カテゴリを選択\",
        \"type\": 3,
        \"required\": true,
        \"choices\": ${CHOICES}
      },
      {
        \"name\": \"action\",
        \"description\": \"アクション (override/clear)\",
        \"type\": 3,
        \"required\": true,
        \"choices\": [
          {\"name\": \"override\", \"value\": \"override\"},
          {\"name\": \"clear\", \"value\": \"clear\"}
        ]
      },
      {
        \"name\": \"status\",
        \"description\": \"オーバーライドするステータス (overrideの場合のみ)\",
        \"type\": 3,
        \"required\": false,
        \"choices\": [
          {\"name\": \"operational\", \"value\": \"operational\"},
          {\"name\": \"degraded\", \"value\": \"degraded\"},
          {\"name\": \"down\", \"value\": \"down\"}
        ]
      }
    ]
  }")

# レスポンスを確認
if echo "$RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
  echo "✅ /status command registered successfully!"
  echo "$RESPONSE" | jq '.'
else
  echo "❌ Failed to register /status command"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo ""
echo "✅ All commands registered successfully!"
