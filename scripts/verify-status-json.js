#!/usr/bin/env node
/**
 * 新 Lambda が出力した status.json を検証する。
 *
 *   node scripts/verify-status-json.js https://status.highemerly.net/data/status.v1.json
 *   node scripts/verify-status-json.js ./downloaded.json
 *
 * 新旧 Lambda を並行稼働させている間、新しい出力が本当に正しいかを
 * 目視ではなく機械的に確かめるためのもの。切り替えの判断に使う。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VALID_CHARS = new Set(['1', 'd', '0', '-']);

const target = process.argv[2];
if (!target) {
  console.error('使い方: node scripts/verify-status-json.js <URL またはファイルパス>');
  process.exit(2);
}

const problems = [];
const warnings = [];

function check(condition, message) {
  if (!condition) problems.push(message);
  return condition;
}

async function load(source) {
  if (/^https?:\/\//.test(source)) {
    // CloudFront のキャッシュを避けて実体を取りに行く
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) throw new Error(`取得に失敗: HTTP ${response.status}`);
    const text = await response.text();
    return { text, age: response.headers.get('age'), cache: response.headers.get('x-cache') };
  }
  return { text: fs.readFileSync(source, 'utf-8') };
}

async function main() {
  const { text, age, cache } = await load(target);
  const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
  console.log(`取得元: ${target}`);
  console.log(`サイズ: ${kb}KB${cache ? `  (x-cache: ${cache}, age: ${age})` : ''}\n`);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    console.error(`JSON として読めません: ${error.message}`);
    process.exit(1);
  }

  // --- 形式 ---
  check(payload.v === 1, `v が 1 でない: ${payload.v}`);
  check(payload.step === 300, `step が 300 でない: ${payload.step}`);
  check(Number.isInteger(payload.points) && payload.points > 0, `points が不正: ${payload.points}`);
  check(typeof payload.services === 'object' && payload.services !== null, 'services がない');

  // --- 時間軸 ---
  const to = new Date(payload.to);
  const from = new Date(payload.from);
  check(!isNaN(to), `to が日付として読めない: ${payload.to}`);
  check(!isNaN(from), `from が日付として読めない: ${payload.from}`);

  if (!isNaN(to)) {
    // 5 分境界に丸まっていること。ここがずれるとサービス間でタイムラインが合わない
    check(
      to.getTime() % (300 * 1000) === 0,
      `to が5分境界に揃っていない: ${payload.to}`
    );

    const ageMinutes = (Date.now() - to.getTime()) / 60000;
    if (ageMinutes > 12) {
      warnings.push(`データが古い（${ageMinutes.toFixed(0)} 分前）。cron が動いていない可能性`);
    }
    console.log(`最終更新: ${payload.to}（${ageMinutes.toFixed(1)} 分前）`);
  }

  if (!isNaN(to) && !isNaN(from) && payload.points) {
    const expected = (payload.points - 1) * payload.step * 1000;
    check(
      to.getTime() - from.getTime() === expected,
      `from と to の間隔が points と合わない（差 ${(to - from) / 1000}s, 期待 ${expected / 1000}s）`
    );
  }

  // --- サービス ---
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config/services.json'), 'utf-8')
  );
  const expectedIds = config.services.map((s) => s.id);
  const actualIds = Object.keys(payload.services || {});

  for (const id of expectedIds) {
    if (!actualIds.includes(id)) problems.push(`サービスが欠けている: ${id}`);
  }
  for (const id of actualIds) {
    if (!expectedIds.includes(id)) warnings.push(`設定にないサービスがある: ${id}`);
  }

  console.log(`\nサービス ${actualIds.length}/${expectedIds.length} 件\n`);

  const tally = { up: 0, degraded: 0, down: 0, unknown: 0 };
  let allUnknown = 0;

  for (const id of actualIds) {
    const entry = payload.services[id];
    const h = entry.h || '';

    if (h.length !== payload.points) {
      problems.push(`${id}: 履歴の長さが ${h.length}（期待 ${payload.points}）`);
    }

    const bad = [...new Set([...h])].filter((c) => !VALID_CHARS.has(c));
    if (bad.length) problems.push(`${id}: 履歴に不正な文字 ${JSON.stringify(bad)}`);

    if (h.length && [...h].every((c) => c === '-')) allUnknown++;

    const last = { 1: 'up', d: 'degraded', 0: 'down', '-': 'unknown' }[h[h.length - 1]];
    if (last !== entry.status) {
      problems.push(`${id}: status(${entry.status}) が履歴の末尾(${last}) と一致しない`);
    }

    tally[entry.status] = (tally[entry.status] || 0) + 1;

    const uptimeKnown = [...h].filter((c) => c !== '-');
    const up = uptimeKnown.filter((c) => c === '1').length;
    const rate = uptimeKnown.length ? ((up / uptimeKnown.length) * 100).toFixed(2) : '—';

    console.log(
      `  ${id.padEnd(18)} ${String(entry.status).padEnd(9)} ` +
      `${String(entry.ms ?? '—').padStart(5)}ms  稼働率 ${String(rate).padStart(6)}%`
    );
  }

  // 全部 unknown なら、クエリかラベルが合っていない
  if (allUnknown > 0) {
    warnings.push(`${allUnknown} 件が全期間 unknown。Prometheus のクエリを確認`);
  }
  if (tally.unknown === actualIds.length && actualIds.length > 0) {
    problems.push('全サービスが unknown。Prometheus に到達できていない可能性');
  }

  // --- 結果 ---
  console.log(`\n内訳: ${JSON.stringify(tally)}`);

  if (warnings.length) {
    console.log('\n警告:');
    warnings.forEach((w) => console.log(`  - ${w}`));
  }

  if (problems.length) {
    console.log('\n問題:');
    problems.forEach((p) => console.log(`  - ${p}`));
    console.log(`\n${problems.length} 件の問題があります。切り替えないでください。`);
    process.exit(1);
  }

  console.log('\n検証 OK。切り替えて問題ありません。');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
