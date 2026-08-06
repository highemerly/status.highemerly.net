// 新スキーマのサイズと、格子・マージロジックの検証

const STEP = 300;
const CODE = { up: '1', down: '0', degraded: 'd', unknown: '-' };
const SERVICE_IDS = [
  'handon-web', 'handon-streaming', 'handon-media', 'handon-search',
  'hiyoko-web', 'hiyoko-media', 'hosteka-web', 'anypost-web',
  'anypost-api', 'dominion-static', 'dominion-api', 'movapic-neo-web',
];

function mergeStatuses(statuses) {
  const known = statuses.filter((s) => s && s !== 'unknown');
  if (known.length === 0) return 'unknown';
  if (known.every((s) => s === 'up')) return 'up';
  if (known.every((s) => s === 'down')) return 'down';
  return 'degraded';
}

// --- 1. マージロジック --------------------------------------------------
const cases = [
  [['up', 'up'], 'up'],
  [['up', 'down'], 'degraded'],          // 旧実装は 'up' を返していた
  [['down', 'down'], 'down'],
  [['up', 'unknown'], 'up'],             // 欠測は判定に含めない
  [['unknown', 'unknown'], 'unknown'],
  [['up', 'down', 'down'], 'degraded'],
  [[], 'unknown'],
];
let ok = true;
for (const [input, expected] of cases) {
  const got = mergeStatuses(input);
  const pass = got === expected;
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  merge([${input}]) = ${got}  (期待 ${expected})`);
}

// --- 2. 5分境界への丸め -------------------------------------------------
console.log('\n--- 時間軸の丸め ---');
const messyNow = new Date('2026-08-06T12:03:47.412Z').getTime();
const endSec = Math.floor(messyNow / 1000 / STEP) * STEP;
console.log(`実時刻   ${new Date(messyNow).toISOString()}`);
console.log(`丸め後   ${new Date(endSec * 1000).toISOString()}  <- 全サービスがこの格子を共有`);

// --- 3. 欠測があっても位置がずれないか ----------------------------------
console.log('\n--- 欠測時の位置合わせ ---');
const points = 6;
const startSec = endSec - (points - 1) * STEP;
const filled = new Array(points).fill('unknown');
// slot 0,1,4,5 だけ返ってきた（2,3 が欠測）という想定
const returned = [0, 1, 4, 5].map((i) => [startSec + i * STEP, '200']);
for (const [ts] of returned) {
  const slot = Math.round((ts - startSec) / STEP);
  filled[slot] = 'up';
}
console.log(`格子: ${filled.map((s) => CODE[s]).join('')}  (期待 11--11)`);
if (filled.map((s) => CODE[s]).join('') !== '11--11') ok = false;

// --- 4. サイズ比較 ------------------------------------------------------
console.log('\n--- サイズ比較 (12サービス) ---');

function newFormat(hours) {
  const n = (hours * 3600) / STEP;
  const services = {};
  for (const id of SERVICE_IDS) {
    services[id] = { status: 'up', ms: 142, h: '1'.repeat(n) };
  }
  return JSON.stringify({
    v: 1, updatedAt: '2026-08-06T12:00:00.000Z', step: STEP, points: n,
    from: '2026-08-04T12:05:00.000Z', to: '2026-08-06T12:00:00.000Z', services,
  });
}

function oldFormat(hours) {
  const n = (hours * 3600) / STEP;
  const services = SERVICE_IDS.map((id) => ({
    id, status: 'up', responseTime: 142,
    lastChecked: '2026-08-06T12:00:00.000Z',
    incidents: [],
    history: Array.from({ length: n }, (_, i) => ({
      timestamp: new Date((Date.UTC(2026, 7, 6) + i * STEP * 1000)).toISOString(),
      status: 'up', value: 200,
    })),
  }));
  // 旧実装は JSON.stringify(status, null, 2) で整形出力していた
  return JSON.stringify({ lastUpdate: '2026-08-06T12:00:00.000Z', services }, null, 2);
}

const kb = (s) => (s.length / 1024).toFixed(1) + 'KB';
console.log(`旧形式  3h : ${kb(oldFormat(3))}   <- 現状`);
console.log(`旧形式 48h : ${kb(oldFormat(48))}`);
console.log(`新形式 48h : ${kb(newFormat(48))}   <- 目標`);
console.log(`\n削減率: ${(100 - (newFormat(48).length / oldFormat(48).length) * 100).toFixed(1)}%`);

// --- 5. 表示期間の切り出し ----------------------------------------------
console.log('\n--- 期間切替 (末尾を切るだけ) ---');
const h48 = '1'.repeat(576);
for (const hours of [1, 3, 12, 24, 48]) {
  const n = (hours * 3600) / STEP;
  console.log(`  ${String(hours).padStart(2)}h -> h.slice(-${n})  = ${h48.slice(-n).length} 点`);
}

console.log(`\n${ok ? '全チェック PASS' : '失敗あり'}`);
process.exit(ok ? 0 : 1);
