#!/bin/bash
#
# Discord のスラッシュコマンドを登録する。
#
#   APPLICATION_ID=xxx BOT_TOKEN=xxx GUILD_ID=xxx ./scripts/register-discord-command.sh
#
# GUILD_ID を指定するとそのサーバー限定（即時反映）、
# 省略するとグローバル（反映まで最大 1 時間）。
#
# カテゴリの選択肢は config/services.json から生成する。
# カテゴリを増やしたらこのスクリプトを流し直すこと。

set -euo pipefail

for required in APPLICATION_ID BOT_TOKEN; do
  if [ -z "${!required:-}" ]; then
    echo "Error: $required が設定されていません" >&2
    exit 1
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq が必要です（brew install jq）" >&2
  exit 1
fi

if [ ! -f config/services.json ]; then
  echo "Error: config/services.json が見つかりません（リポジトリのルートで実行してください）" >&2
  exit 1
fi

if [ -n "${GUILD_ID:-}" ]; then
  ENDPOINT="https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands"
  echo "サーバー ${GUILD_ID} 限定で登録します"
else
  ENDPOINT="https://discord.com/api/v10/applications/${APPLICATION_ID}/commands"
  echo "グローバルに登録します（反映まで最大 1 時間）"
fi

# name は日本語表示にしたい。多言語オブジェクトなら ja、文字列ならそのまま。
# .name.ja // .name は name が文字列のとき「文字列を文字列で索引できない」で落ちる
CATEGORY_CHOICES=$(jq -c '
  [.categories[] | {
    name: (if (.name | type) == "object" then (.name.ja // .name.en) else .name end),
    value: .id
  }]
' config/services.json)

COMMAND=$(jq -n --argjson categories "$CATEGORY_CHOICES" '{
  name: "announce",
  description: "ステータスページのお知らせを追加・削除する",
  options: [
    {
      name: "action",
      description: "追加するか削除するか",
      type: 3,
      required: true,
      choices: [
        {name: "create（追加）", value: "create"},
        {name: "delete（削除）", value: "delete"}
      ]
    },
    {
      name: "title",
      description: "見出し（create のとき必須）",
      type: 3,
      required: false
    },
    {
      name: "body",
      description: "本文",
      type: 3,
      required: false
    },
    {
      name: "level",
      description: "種別（既定: info）",
      type: 3,
      required: false,
      choices: [
        {name: "info（お知らせ）", value: "info"},
        {name: "maintenance（メンテナンス）", value: "maintenance"},
        {name: "incident（障害）", value: "incident"}
      ]
    },
    {
      name: "category",
      description: "関連するサービス",
      type: 3,
      required: false,
      choices: $categories
    },
    {
      name: "title_en",
      description: "見出し（英語）",
      type: 3,
      required: false
    },
    {
      name: "body_en",
      description: "本文（英語）",
      type: 3,
      required: false
    },
    {
      name: "id",
      description: "削除するお知らせの id（delete のとき必須）",
      type: 3,
      required: false
    }
  ]
}')

RESPONSE=$(curl -sS -X POST "$ENDPOINT" \
  -H "Authorization: Bot ${BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$COMMAND")

if echo "$RESPONSE" | jq -e '.id' >/dev/null 2>&1; then
  echo "/announce を登録しました"
  echo "$RESPONSE" | jq '{id, name, description, options: [.options[].name]}'
else
  echo "/announce の登録に失敗しました" >&2
  echo "$RESPONSE" | jq '.' >&2
  exit 1
fi

cat <<'NOTE'

旧 /status コマンドは廃止した。
ステータスの手動上書きは新構成では未実装で、Prometheus の観測結果がそのまま出る。
不要なコマンドが残っている場合は ./scripts/delete-discord-commands.sh で消せる。
NOTE
