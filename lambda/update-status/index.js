/**
 * UpdateStatusFunction
 *
 * EventBridge から 5 分ごとに起動され、Prometheus を読んで
 * S3 の data/status.json を更新する。
 *
 * 旧実装との違い:
 *  - アクセス契機の更新判定を廃止（EventBridge cron に一本化）
 *  - 時間軸を 5 分境界に丸め、全サービスで同一の格子を共有する
 *  - 複数クエリを持つサービスは履歴もマージする（旧実装は先頭 1 本だけ見ていた）
 *  - 履歴を 1 点 1 文字にエンコードして 48 時間分を約 8KB に収める
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const s3Client = new S3Client({ region: REGION });
const ssmClient = new SSMClient({ region: REGION });

const S3_BUCKET = process.env.S3_BUCKET;
const HISTORY_HOURS = parseInt(process.env.HISTORY_HOURS || '48', 10);
const STEP_SECONDS = 300; // 5 分。フロントの表示単位と一致させる
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '10000', 10);

const PROMETHEUS_URL_PARAM = process.env.PROMETHEUS_URL_PARAM || '/status-page/prometheus/url';
const PROMETHEUS_USERNAME_PARAM = process.env.PROMETHEUS_USERNAME_PARAM || '/status-page/prometheus/username';
const PROMETHEUS_PASSWORD_PARAM = process.env.PROMETHEUS_PASSWORD_PARAM || '/status-page/prometheus/password';

// 履歴 1 点をこの 1 文字で表す
const CODE = { up: '1', down: '0', degraded: 'd', unknown: '-' };

/** SSM の値は起動間で使い回す（コンテナ再利用時の SSM 呼び出しを減らす） */
let cachedPrometheusConfig = null;

exports.handler = async () => {
  const startedAt = Date.now();

  // 時間軸は「今」ではなく直近の 5 分境界を終端にする。
  // ここを一度だけ計算して全サービスに配ることが重要。
  // サービスごとに Date.now() を評価すると格子がずれ、タイムラインがマージできなくなる。
  const endSec = Math.floor(Date.now() / 1000 / STEP_SECONDS) * STEP_SECONDS;
  const points = (HISTORY_HOURS * 3600) / STEP_SECONDS;
  const startSec = endSec - (points - 1) * STEP_SECONDS;

  const [prometheus, config] = await Promise.all([
    getPrometheusConfig(),
    getConfigFromS3(),
  ]);

  const grid = { startSec, endSec, points, step: STEP_SECONDS };
  const results = await Promise.all(
    config.services.map((service) => buildServiceEntry(prometheus, service, grid))
  );

  const services = {};
  for (const entry of results) {
    services[entry.id] = entry.data;
  }

  const payload = {
    v: 1,
    updatedAt: new Date(endSec * 1000).toISOString(),
    step: STEP_SECONDS,
    points,
    from: new Date(startSec * 1000).toISOString(),
    to: new Date(endSec * 1000).toISOString(),
    services,
  };

  await putStatusToS3(payload);

  const body = JSON.stringify(payload);
  console.log(
    `Updated ${Object.keys(services).length} services in ${Date.now() - startedAt}ms, ` +
    `${(body.length / 1024).toFixed(1)}KB`
  );

  return { ok: true, services: Object.keys(services).length, bytes: body.length };
};

/* ------------------------------------------------------------------ *
 * サービス単位の組み立て
 * ------------------------------------------------------------------ */

async function buildServiceEntry(prometheus, service, grid) {
  const queries = Array.isArray(service.prometheusQuery)
    ? service.prometheusQuery
    : [service.prometheusQuery];

  try {
    // 各コンポーネントの履歴を格子に載せて取得し、時刻ごとにマージする。
    // 現在値は履歴の最終点と同じものを使う（別クエリを撃つと両者がずれるため）。
    const perQuery = await Promise.all(
      queries.map((q) => fetchHistoryOnGrid(prometheus, q, grid))
    );

    const merged = [];
    for (let i = 0; i < grid.points; i++) {
      merged.push(mergeStatuses(perQuery.map((series) => series[i])));
    }

    const data = {
      status: merged[merged.length - 1],
      h: merged.map((s) => CODE[s]).join(''),
    };

    const ms = await fetchLatency(prometheus, service, queries);
    if (ms !== undefined) data.ms = ms;

    return { id: service.id, data };
  } catch (error) {
    console.error(`Failed to build ${service.id}:`, error.message);
    return {
      id: service.id,
      data: { status: 'unknown', h: CODE.unknown.repeat(grid.points) },
    };
  }
}

/**
 * 複数コンポーネントのステータスをマージする。
 *
 * 旧実装は「1 つでも up なら up」だったため、一部が落ちていても
 * 全体が正常と表示されていた。ここでは全体が揃って初めて up とする。
 */
function mergeStatuses(statuses) {
  const known = statuses.filter((s) => s && s !== 'unknown');
  if (known.length === 0) return 'unknown';

  if (known.every((s) => s === 'up')) return 'up';
  if (known.every((s) => s === 'down')) return 'down';
  return 'degraded'; // 一部だけ生きている
}

/* ------------------------------------------------------------------ *
 * Prometheus
 * ------------------------------------------------------------------ */

/**
 * query_range を叩き、結果を固定長の格子（配列）に載せて返す。
 *
 * Prometheus は step で刻んだ点を返すが、欠測があると点が飛ぶ。
 * 位置合わせを添字任せにせず、必ずタイムスタンプで引き当てる。
 */
async function fetchHistoryOnGrid(prometheus, query, grid) {
  const filled = new Array(grid.points).fill('unknown');

  const json = await prometheusRequest(prometheus, 'query_range', {
    query,
    start: String(grid.startSec),
    end: String(grid.endSec),
    step: String(grid.step),
  });

  const series = json?.data?.result;
  if (!Array.isArray(series) || series.length === 0) return filled;

  // 同一クエリが複数系列を返すこともある（instance 違いなど）。時刻ごとにまとめる
  const byTime = new Map();
  for (const s of series) {
    for (const [ts, valueStr] of s.values || []) {
      const slot = Math.round((ts - grid.startSec) / grid.step);
      if (slot < 0 || slot >= grid.points) continue;
      if (!byTime.has(slot)) byTime.set(slot, []);
      byTime.get(slot).push(statusFromValue(parseFloat(valueStr)));
    }
  }

  for (const [slot, statuses] of byTime) {
    filled[slot] = mergeStatuses(statuses);
  }

  return filled;
}

/**
 * レスポンスタイムを取得する。
 *
 * 旧実装はクエリから instance ラベルを正規表現で抜き出していたが、
 * config/services.json は endpoint / env / service ラベルを使っており
 * instance を含まないため、常に undefined になっていた。
 * ここではメトリック名だけを probe_duration_seconds に差し替えてラベルを流用する。
 */
async function fetchLatency(prometheus, service, queries) {
  const query = service.latencyQuery || deriveLatencyQuery(queries[0]);
  if (!query) return undefined;

  try {
    const json = await prometheusRequest(prometheus, 'query', { query });
    const first = json?.data?.result?.[0];
    if (!first) return undefined;
    return Math.round(parseFloat(first.value[1]) * 1000);
  } catch (error) {
    console.warn(`No latency for ${service.id}: ${error.message}`);
    return undefined;
  }
}

/** probe_http_status_code{...} → probe_duration_seconds{...} */
function deriveLatencyQuery(query) {
  if (typeof query !== 'string') return null;
  const match = query.match(/^\s*probe_[a-z_]+(\{.*\})\s*$/s);
  return match ? `probe_duration_seconds${match[1]}` : null;
}

async function prometheusRequest(prometheus, path, params) {
  const url = new URL(`${prometheus.url.replace(/\/$/, '')}/api/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const headers = {};
  if (prometheus.auth) {
    const token = Buffer.from(
      `${prometheus.auth.username}:${prometheus.auth.password}`
    ).toString('base64');
    headers.Authorization = `Basic ${token}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Prometheus ${path} returned ${response.status}`);
  }

  return response.json();
}

/**
 * Prometheus の生値をステータスに変換する。
 *
 * probe_success 形式 (0/1) と HTTP ステータスコード形式の両方を受ける。
 * 0 は前者では down、後者では「接続できなかった」を意味するのでどちらも down。
 */
function statusFromValue(value) {
  if (!Number.isFinite(value)) return 'unknown';
  if (value === 0) return 'down';
  if (value === 1) return 'up';
  if (value >= 200 && value < 400) return 'up';
  if (value >= 400) return 'down';
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * S3 / SSM
 * ------------------------------------------------------------------ */

async function putStatusToS3(payload) {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'data/status.json',
    // 整形出力しない。インデントだけで 3 割増える
    Body: JSON.stringify(payload),
    ContentType: 'application/json',
    // invalidation は使わない。5 分更新に対して 60 秒キャッシュで十分で、
    // 毎回 invalidation を打つと月 $38 かかる（無料枠 1,000 パス/月）
    CacheControl: 'public, max-age=60, s-maxage=60',
  }));
}

async function getConfigFromS3() {
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'config/services.json',
  }));
  return JSON.parse(await response.Body.transformToString());
}

async function getPrometheusConfig() {
  if (cachedPrometheusConfig) return cachedPrometheusConfig;

  const [url, username, password] = await Promise.all([
    getSSMParameter(PROMETHEUS_URL_PARAM),
    getSSMParameter(PROMETHEUS_USERNAME_PARAM),
    getSSMParameter(PROMETHEUS_PASSWORD_PARAM),
  ]);

  if (!url) throw new Error(`Prometheus URL not found at ${PROMETHEUS_URL_PARAM}`);

  cachedPrometheusConfig = {
    url,
    auth: username && password ? { username, password } : undefined,
  };
  return cachedPrometheusConfig;
}

async function getSSMParameter(name) {
  try {
    const response = await ssmClient.send(new GetParameterCommand({
      Name: name,
      WithDecryption: true,
    }));
    return response.Parameter.Value;
  } catch (error) {
    console.warn(`SSM parameter ${name}: ${error.message}`);
    return null;
  }
}
