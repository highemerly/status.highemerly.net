#!/usr/bin/env python3
"""Discord のインタラクションに結果を返す。

announce ワークフローの最後に呼ばれる。これが無いと、反映に失敗しても
投稿者は成功したと思ったままになる。障害対応中にそれは困る。

入力（すべて環境変数）:
    APPLICATION_ID     Discord アプリケーション ID
    INTERACTION_TOKEN  インタラクショントークン（発行から 15 分間有効）
    OUTCOME            success ならその旨、それ以外は失敗として扱う
    RUN_URL            失敗時に案内するワークフロー実行の URL

送る文言はこのファイル内で決め打ちする。Discord から届いた文字列は使わない。
"""

import json
import os
import sys
import urllib.request

SITE = "https://status.highemerly.net/"


def main() -> int:
    application_id = os.environ.get("APPLICATION_ID", "")
    token = os.environ.get("INTERACTION_TOKEN", "")
    if not application_id or not token:
        print("通知先が指定されていないため、Discord への返信は省略")
        return 0

    if os.environ.get("OUTCOME") == "success":
        content = f"✅ 受け付けました。1〜2 分で反映されます。\n{SITE}"
    else:
        run_url = os.environ.get("RUN_URL", "")
        content = "❌ 反映に失敗しました。内容を確認してください。"
        if run_url:
            content += f"\n{run_url}"

    request = urllib.request.Request(
        f"https://discord.com/api/v10/webhooks/{application_id}/{token}/messages/@original",
        data=json.dumps({"content": content}).encode("utf-8"),
        method="PATCH",
        headers={"Content-Type": "application/json"},
    )

    try:
        urllib.request.urlopen(request, timeout=10)
        print("Discord に結果を返しました")
    except Exception as error:  # noqa: BLE001 - 通知失敗で本処理を巻き戻さない
        # お知らせ自体の反映はすでに終わっている。ここでの失敗は握り潰してよい
        print(f"Discord への通知に失敗: {error}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
