#!/bin/bash

# Discord Slash Commandを全て削除するスクリプト

set -e

# 環境変数の確認
if [ -z "$APPLICATION_ID" ]; then
  echo "Error: APPLICATION_ID environment variable is not set"
  echo "Usage: APPLICATION_ID=xxx BOT_TOKEN=xxx GUILD_ID=xxx ./scripts/delete-discord-commands.sh"
  exit 1
fi

if [ -z "$BOT_TOKEN" ]; then
  echo "Error: BOT_TOKEN environment variable is not set"
  echo "Usage: APPLICATION_ID=xxx BOT_TOKEN=xxx GUILD_ID=xxx ./scripts/delete-discord-commands.sh"
  exit 1
fi

# GUILD_IDが指定されていればギルド固有コマンド、なければグローバルコマンド
if [ -n "$GUILD_ID" ]; then
  ENDPOINT="https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands"
  echo "Deleting guild-specific commands for guild ${GUILD_ID}..."
else
  ENDPOINT="https://discord.com/api/v10/applications/${APPLICATION_ID}/commands"
  echo "Deleting global commands..."
fi

# jqがインストールされているか確認
if ! command -v jq &> /dev/null; then
  echo "Error: jq is not installed. Please install jq to use this script."
  echo "  macOS: brew install jq"
  echo "  Ubuntu/Debian: apt-get install jq"
  exit 1
fi

# 既存のコマンド一覧を取得
echo "Fetching existing commands..."
COMMANDS=$(curl -s -X GET "$ENDPOINT" \
  -H "Authorization: Bot ${BOT_TOKEN}")

# コマンドがあるか確認
COMMAND_COUNT=$(echo "$COMMANDS" | jq '. | length')

if [ "$COMMAND_COUNT" -eq 0 ]; then
  echo "No commands to delete."
  exit 0
fi

echo "Found $COMMAND_COUNT command(s):"
echo "$COMMANDS" | jq '.[] | {id, name, description}'

# 各コマンドを削除
echo ""
echo "Deleting commands..."
echo "$COMMANDS" | jq -r '.[] | .id' | while read -r COMMAND_ID; do
  COMMAND_NAME=$(echo "$COMMANDS" | jq -r ".[] | select(.id==\"$COMMAND_ID\") | .name")
  echo "Deleting command: $COMMAND_NAME (ID: $COMMAND_ID)"

  DELETE_RESPONSE=$(curl -s -X DELETE "${ENDPOINT}/${COMMAND_ID}" \
    -H "Authorization: Bot ${BOT_TOKEN}")

  if [ -z "$DELETE_RESPONSE" ]; then
    echo "  ✅ Deleted successfully"
  else
    echo "  ❌ Failed to delete"
    echo "$DELETE_RESPONSE" | jq '.'
  fi
done

echo ""
echo "✅ All commands deleted!"
