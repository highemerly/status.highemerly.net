#!/usr/bin/env node
/**
 * k8s リポジトリの本番マニフェストから、各サービスの稼働バージョンを取り出す。
 * リリースノートが取得できるものは、そのリンクも添えて config/versions.json に書く。
 *
 *   K8S_REPO=../k8sg1 node scripts/build-versions.js
 *
 * 取得元は config/services.json の categories[].version で宣言する:
 *
 *   "version": {
 *     "manifest": "manifests/handon/prd/web.yaml",
 *     "image": "ghcr.io/highemerly/mastodon",
 *     "displayPattern": "^(\\d+\\.\\d+\\.\\d+)",   // 省略可。タグから表示用を抽出
 *     "releases": { "repo": "mastodon/mastodon", "tagPrefix": "v" }   // 省略可
 *   }
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const K8S_REPO = process.env.K8S_REPO || path.join(ROOT, '..', 'k8sg1');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const OUTPUT = path.join(ROOT, 'config/versions.json');

/**
 * マニフェストから image のタグを取り出す。
 *
 * YAML パーサを入れずに正規表現で読む。マニフェストの image 行は
 * `image: <レジストリ>/<名前>:<タグ>` の一形式しかなく、対象のイメージ名で
 * 固定してから引くので誤検出しない。依存を増やさない方を優先した。
 * 将来 Kustomize の images 差し替えや Helm を使い始めたら、この方針は破綻する。
 */
function extractTag(manifestPath, image) {
  const source = fs.readFileSync(manifestPath, 'utf-8');
  const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\s*image:\\s*${escaped}:(\\S+)\\s*$`, 'm'));
  if (!match) {
    throw new Error(`${image} の image 行が ${manifestPath} に見つかりません`);
  }
  return match[1];
}

async function fetchRelease(releases, tag) {
  const prefix = releases.tagPrefix || '';
  const url = `https://api.github.com/repos/${releases.repo}/releases/tags/${prefix}${tag}`;

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'status-highemerly-net',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const response = await fetch(url, { headers });

  // 自作サービスはリリースを切っていないことがある。無くても処理は続ける
  if (response.status === 404) return null;
  if (!response.ok) {
    console.warn(`  リリース取得に失敗 (${response.status}): ${releases.repo} ${prefix}${tag}`);
    return null;
  }

  const release = await response.json();
  return {
    name: release.name || release.tag_name,
    url: release.html_url,
    publishedAt: release.published_at,
  };
}

async function main() {
  if (!fs.existsSync(K8S_REPO)) {
    throw new Error(`k8s リポジトリが見つかりません: ${K8S_REPO}`);
  }

  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'config/services.json'), 'utf-8')
  );

  const categories = {};
  let failures = 0;

  for (const category of config.categories) {
    const spec = category.version;
    if (!spec) continue;

    try {
      const manifestPath = path.join(K8S_REPO, spec.manifest);
      const tag = extractTag(manifestPath, spec.image);

      // 表示用バージョン。独自ビルドのタグは接尾辞を落として本家の版に揃える
      // 例: 4.6.4-20260730131238 -> 4.6.4
      let version = tag;
      if (spec.displayPattern) {
        const match = tag.match(new RegExp(spec.displayPattern));
        if (match) version = match[1];
      }

      const entry = { version, imageTag: tag };

      if (spec.releases) {
        const release = await fetchRelease(spec.releases, version);
        if (release) entry.release = release;
      }

      categories[category.id] = entry;
      console.log(
        `${category.id.padEnd(14)} ${version.padEnd(22)}` +
        `${entry.release ? entry.release.url : 'リリースノートなし'}`
      );
    } catch (error) {
      // 1 つ落ちても他のバージョンは出したいので、記録して続行する
      failures++;
      console.error(`${category.id.padEnd(14)} 失敗: ${error.message}`);
    }
  }

  // バージョンが変わっていないなら updatedAt も据え置く。
  // 毎回時刻を書き換えると、中身が同じでも git 差分が出てしまい、
  // 定期実行のたびに無意味なコミットとデプロイが走る。
  let updatedAt = new Date().toISOString();
  if (fs.existsSync(OUTPUT)) {
    const previous = JSON.parse(fs.readFileSync(OUTPUT, 'utf-8'));
    const unchanged =
      JSON.stringify(previous.categories) === JSON.stringify(categories);
    if (unchanged) {
      updatedAt = previous.updatedAt;
      console.log('\nバージョンに変更なし');
    }
  }

  const payload = { updatedAt, categories };

  fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`${path.relative(ROOT, OUTPUT)} に ${Object.keys(categories).length} 件を書き出しました`);

  // 全滅ならマニフェストの構成が変わった可能性が高いので、失敗として扱う
  if (Object.keys(categories).length === 0 && failures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
