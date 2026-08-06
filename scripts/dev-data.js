#!/usr/bin/env node
/**
 * ローカル開発用のダミーデータを public/ に生成する。
 *
 * 本番では data/status.json は Lambda が S3 に置き、config/services.json は
 * GitHub Actions が配置する。開発時はそれらが無いので、ここで用意する。
 * 生成物は .gitignore 済み（config の正本は config/services.json のみ）。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STEP = 300;
const HOURS = 48;
const POINTS = (HOURS * 3600) / STEP;

const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'config/services.json'), 'utf-8')
);

// 決定的な擬似乱数。実行のたびに絵が変わると差分の確認がしづらい
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** 障害を数回挟んだ履歴を作る */
function fakeHistory(seed) {
  const random = makeRandom(seed);
  const chars = new Array(POINTS).fill('1');

  const outages = Math.floor(random() * 3);
  for (let i = 0; i < outages; i++) {
    const start = Math.floor(random() * (POINTS - 20));
    const length = 2 + Math.floor(random() * 10);
    const kind = random() < 0.4 ? 'd' : '0';
    for (let j = start; j < Math.min(start + length, POINTS); j++) {
      chars[j] = kind;
    }
  }

  // 冒頭に欠測を混ぜて、unknown の見え方も確認できるようにする
  if (random() < 0.3) {
    for (let j = 0; j < 8; j++) chars[j] = '-';
  }

  return chars.join('');
}

const endSec = Math.floor(Date.now() / 1000 / STEP) * STEP;
const startSec = endSec - (POINTS - 1) * STEP;

// 全部 up だと異常時の見た目を確認できないので、2 つだけ現在進行形の障害にする
const ONGOING = { 1: 'd', 4: '0' };

const services = {};
config.services.forEach((service, index) => {
  let h = fakeHistory(index * 7919 + 13);
  if (ONGOING[index]) {
    h = h.slice(0, -6) + ONGOING[index].repeat(6);
  }
  const last = h[h.length - 1];
  services[service.id] = {
    status: { '1': 'up', d: 'degraded', '0': 'down', '-': 'unknown' }[last],
    ms: 40 + ((index * 37) % 260),
    h,
  };
});

const status = {
  v: 1,
  updatedAt: new Date(endSec * 1000).toISOString(),
  step: STEP,
  points: POINTS,
  from: new Date(startSec * 1000).toISOString(),
  to: new Date(endSec * 1000).toISOString(),
  services,
};

const announcements = {
  announcements: [
    {
      id: 'sample-1',
      level: 'maintenance',
      title: {
        ja: 'データベースのメンテナンスを行います',
        en: 'Scheduled database maintenance',
      },
      body: {
        ja: '8月10日 02:00 から 03:00 まで、投稿の閲覧ができなくなります。',
        en: 'Posts will be unavailable from 02:00 to 03:00 on 10 August.',
      },
      publishedAt: new Date(endSec * 1000 - 3600 * 1000).toISOString(),
    },
  ],
};

function write(relative, data) {
  const target = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data));
  const kb = (fs.statSync(target).size / 1024).toFixed(1);
  console.log(`${relative}  ${kb}KB`);
}

write('public/data/status.json', status);
write('public/content/announcements.json', announcements);
write('public/config/services.json', config);

// バージョンは scripts/build-versions.js が作る。まだ無ければ飛ばす
const versionsPath = path.join(ROOT, 'config/versions.json');
if (fs.existsSync(versionsPath)) {
  write('public/config/versions.json', JSON.parse(fs.readFileSync(versionsPath, 'utf-8')));
} else {
  console.log('config/versions.json は未生成のため省略');
}
