# お知らせ

このディレクトリの `*.md` が、ステータスページ上部の「お知らせ」欄になる。

ファイルを追加して `main` に push すれば公開され、削除すれば消える。
Discord の `/announce` からも同じ場所に書き込まれる（下記）。

このファイル（`README.md`）はビルド時に除外されるので、お知らせにはならない。

## 書き方

ファイル名がそのまま識別子になる。日付を先頭に付けると並びが分かりやすい。

`2026-08-10-db-maintenance.md`:

```markdown
---
level: maintenance
category: handon-club
publishedAt: 2026-08-07T12:00:00+09:00
title.ja: データベースのメンテナンスを行います
title.en: Scheduled database maintenance
---

## ja

8月10日 02:00 から 03:00 まで、投稿の閲覧ができなくなります。

## en

Posts will be unavailable from 02:00 to 03:00 on 10 August.
```

### 設定部（`---` で囲む部分）

| キー | 必須 | 内容 |
|---|---|---|
| `title.ja` | ○ | 見出し（日本語） |
| `title.en` | | 見出し（英語）。無ければ日本語が出る |
| `publishedAt` | ○ | 日時。ISO 8601 形式。新しいものが上に並ぶ |
| `level` | | `info`（既定）/ `maintenance` / `incident`。左の色帯が変わる |
| `category` | | 関連するサービスの ID。`config/services.json` の `categories[].id` |

**1 行 1 キーの平坦な形式のみ。** 入れ子や配列は使えない。
多言語は `title.ja` のようにドットで表す。

### 本文（`---` より下）

省略してよい。書く場合は `## ja` / `## en` で言語を区切る。
見出しが無ければ全体を日本語として扱う。

## 検証

```bash
node scripts/build-announcements.js
```

`level` が不正、`category` が存在しない、`publishedAt` が読めない、といった場合は
**ビルドを失敗させる**。壊れたまま公開されるより、その場で気づけるようにしている。

## Discord から投稿する場合

```
/announce action:create title:メンテナンスのお知らせ body:... level:maintenance category:handon-club
/announce action:delete id:2026-08-07-08-54-52
```

`create` すると Bot が `id` を返す。削除にはその `id` を使う。

Discord Bot は S3 を直接触らない。GitHub に `repository_dispatch` を送り、
[`announce.yml`](../../.github/workflows/announce.yml) がこのディレクトリに
ファイルを作って（または消して）コミットする。

そのため **Discord 経由でも変更履歴が git に残り、巻き戻せる**。
反映まではビルドとデプロイのぶん 1〜2 分かかる。
