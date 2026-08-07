#!/usr/bin/env node
/**
 * Discord から届いたお知らせを content/announcements/ に反映する。
 *
 *   ANNOUNCEMENT_PAYLOAD='{"action":"create",...}' node scripts/apply-announcement.js
 *
 * 入力は Discord 利用者が打った任意の文字列なので、シェルや YAML に
 * そのまま埋め込まない。環境変数から JSON として受け取り、この中で組み立てる。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'content/announcements');

const LEVELS = ['info', 'maintenance', 'incident'];

// ファイル名に使える形を厳しく限定する。
// これを緩めると ../../.github/workflows/deploy.yml のような指定で
// 関係ないファイルを消せてしまう。
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** 見出しは 1 行でなければ形式が壊れる。改行と制御文字を潰す */
function oneLine(value, limit = 200) {
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limit);
}

/** 本文は改行だけ残し、それ以外の制御文字は落とす */
function multiLine(value, limit = 2000) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limit);
}

function fail(message) {
  console.error(`お知らせの反映に失敗: ${message}`);
  process.exit(1);
}

function main() {
  const raw = process.env.ANNOUNCEMENT_PAYLOAD;
  if (!raw) fail('ANNOUNCEMENT_PAYLOAD が空です');

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    fail(`ANNOUNCEMENT_PAYLOAD が JSON として読めません: ${error.message}`);
  }

  const id = String(payload.id || '');
  if (!ID_PATTERN.test(id)) {
    fail(`id が不正です（${id}）。英小文字・数字・ハイフンのみ、63 文字以内`);
  }

  const target = path.join(DIR, `${id}.md`);
  // 念のため、組み立てた実パスが想定ディレクトリの中にあることも確かめる
  if (path.dirname(path.resolve(target)) !== path.resolve(DIR)) {
    fail('対象がお知らせディレクトリの外を指しています');
  }

  if (payload.action === 'delete') {
    if (!fs.existsSync(target)) fail(`${id} は存在しません`);
    fs.unlinkSync(target);
    console.log(`削除: content/announcements/${id}.md`);
    return;
  }

  if (payload.action !== 'create') {
    fail(`action が不正です（${payload.action}）。create / delete のいずれか`);
  }

  const title = oneLine(payload.title || '');
  if (!title) fail('title が空です');

  const level = payload.level || 'info';
  if (!LEVELS.includes(level)) {
    fail(`level が不正です（${level}）。${LEVELS.join(' / ')} のいずれか`);
  }

  const categories = new Set(
    JSON.parse(fs.readFileSync(path.join(ROOT, 'config/services.json'), 'utf-8'))
      .categories.map((c) => c.id)
  );
  const category = payload.category ? oneLine(payload.category, 64) : '';
  if (category && !categories.has(category)) {
    fail(`category "${category}" は config/services.json にありません`);
  }

  const publishedAt = payload.publishedAt
    ? new Date(payload.publishedAt)
    : new Date();
  if (isNaN(publishedAt)) fail(`publishedAt が日付として読めません（${payload.publishedAt}）`);

  const lines = [
    '---',
    `level: ${level}`,
  ];
  if (category) lines.push(`category: ${category}`);
  lines.push(`publishedAt: ${publishedAt.toISOString()}`);
  lines.push(`title.ja: ${title}`);

  const titleEn = oneLine(payload.titleEn || '');
  if (titleEn) lines.push(`title.en: ${titleEn}`);

  lines.push('---', '');

  const body = multiLine(payload.body || '');
  const bodyEn = multiLine(payload.bodyEn || '');
  if (body && bodyEn) {
    lines.push('## ja', '', body, '', '## en', '', bodyEn, '');
  } else if (body) {
    lines.push(body, '');
  }

  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(target, lines.join('\n'));

  console.log(`作成: content/announcements/${id}.md`);
  console.log('---');
  console.log(lines.join('\n'));
}

main();
