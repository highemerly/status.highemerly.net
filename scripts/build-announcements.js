#!/usr/bin/env node
/**
 * content/announcements/*.md を読んで public/content/announcements.json を作る。
 *
 * public/ に置くのは、Next.js が静的エクスポート時に out/ へそのまま複写するため。
 * ビルド前に必ず走らせる（package.json の build に組み込んである）。
 *
 * data/ ではなく content/ に置く理由:
 *   data/ は Lambda の領域で、GitHub Actions は IAM ポリシーで書き込みを
 *   拒否されている。お知らせは Actions が作るので別のプレフィックスにする。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'content/announcements');
const OUTPUT = path.join(ROOT, 'public/content/announcements.json');

const LEVELS = ['info', 'maintenance', 'incident'];
const LANGS = ['ja', 'en'];

/**
 * 先頭の --- で囲まれた部分をキー: 値として読む。
 *
 * YAML パーサは入れない。ここで許すのは「1 行 1 キー」の平坦な形式だけで、
 * 入れ子も配列も使わないため、パーサを持ち込む価値がない。
 * 多言語は title.ja のようにドットで表す。
 */
function parseFile(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${file}: 先頭の --- で囲まれた設定部が見つかりません`);
  }

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const sep = line.indexOf(':');
    if (sep === -1) throw new Error(`${file}: "${line}" は キー: 値 の形式ではありません`);

    meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }

  return { meta, body: match[2] };
}

/**
 * 本文を言語ごとに切り分ける。
 * "## ja" / "## en" の見出しで区切る。見出しが無ければ全体を日本語とみなす。
 */
function parseBody(body) {
  const trimmed = body.trim();
  if (!trimmed) return {};

  if (!/^##\s+(ja|en)\s*$/m.test(trimmed)) {
    return { ja: trimmed };
  }

  const result = {};
  let current = null;
  const buffer = [];

  const flush = () => {
    if (!current) return;
    const text = buffer.join('\n').trim();
    if (text) result[current] = text;
    buffer.length = 0;
  };

  for (const line of trimmed.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(ja|en)\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  return result;
}

/** title.ja / title.en を { ja, en } にまとめる */
function collectLocalized(meta, prefix, file, required) {
  const value = {};
  for (const lang of LANGS) {
    const text = meta[`${prefix}.${lang}`];
    if (text) value[lang] = text;
  }
  // ドットなしの指定も日本語として受ける
  if (meta[prefix]) value.ja = meta[prefix];

  if (required && !value.ja && !value.en) {
    throw new Error(`${file}: ${prefix}.ja が必要です`);
  }
  return Object.keys(value).length ? value : undefined;
}

function main() {
  const categoryIds = new Set(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'config/services.json'), 'utf-8'))
      .categories.map((c) => c.id)
  );

  const files = fs.existsSync(SOURCE_DIR)
    ? fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md')
    : [];

  const announcements = files.map((file) => {
    const { meta, body } = parseFile(
      fs.readFileSync(path.join(SOURCE_DIR, file), 'utf-8'),
      file
    );

    const level = meta.level || 'info';
    if (!LEVELS.includes(level)) {
      throw new Error(`${file}: level が不正です（${level}）。${LEVELS.join(' / ')} のいずれか`);
    }

    // 存在しないカテゴリを指すと画面に出ないまま気づけないので、ここで落とす
    if (meta.category && !categoryIds.has(meta.category)) {
      throw new Error(`${file}: category "${meta.category}" は config/services.json にありません`);
    }

    if (!meta.publishedAt) throw new Error(`${file}: publishedAt が必要です`);
    const publishedAt = new Date(meta.publishedAt);
    if (isNaN(publishedAt)) {
      throw new Error(`${file}: publishedAt が日付として読めません（${meta.publishedAt}）`);
    }

    const entry = {
      id: file.replace(/\.md$/, ''),
      level,
      title: collectLocalized(meta, 'title', file, true),
      publishedAt: publishedAt.toISOString(),
    };

    if (meta.category) entry.categoryId = meta.category;

    const text = parseBody(body);
    if (Object.keys(text).length) entry.body = text;

    return entry;
  });

  // 新しいものから並べる
  announcements.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify({ announcements }));

  console.log(
    `${path.relative(ROOT, OUTPUT)} に ${announcements.length} 件を書き出しました` +
    (announcements.length ? `: ${announcements.map((a) => a.id).join(', ')}` : '')
  );
}

try {
  main();
} catch (error) {
  console.error(`お知らせのビルドに失敗: ${error.message}`);
  process.exit(1);
}
