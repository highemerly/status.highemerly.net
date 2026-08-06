/**
 * UpdateStatusFunction
 *
 * Prometheusからデータを取得してS3の /data/status.json を更新する
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const axios = require('axios');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });

const S3_BUCKET = process.env.S3_BUCKET;
const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE || '180', 10); // 3分（秒）

// SSM Parameter名
const PROMETHEUS_URL_PARAM = process.env.PROMETHEUS_URL_PARAM || '/status-page/prometheus/url';
const PROMETHEUS_USERNAME_PARAM = process.env.PROMETHEUS_USERNAME_PARAM || '/status-page/prometheus/username';
const PROMETHEUS_PASSWORD_PARAM = process.env.PROMETHEUS_PASSWORD_PARAM || '/status-page/prometheus/password';

/**
 * Lambda Handler
 */
exports.handler = async (event) => {
  try {
    console.log('Event:', JSON.stringify(event));

    // 1. S3から現在のstatus.jsonを取得
    const currentStatus = await getStatusFromS3();
    const lastUpdate = new Date(currentStatus.lastUpdate);
    const now = new Date();
    const ageInSeconds = (now - lastUpdate) / 1000;

    console.log(`Current lastUpdate: ${lastUpdate.toISOString()}, Age: ${ageInSeconds}s`);

    // 2. 3分未満なら更新不要（ただし、最新データは返す）
    if (ageInSeconds < CACHE_MAX_AGE) {
      console.log('Status is still fresh, no update needed');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=300'
        },
        body: JSON.stringify({
          lastUpdate: currentStatus.lastUpdate,
          services: currentStatus.services
        })
      };
    }

    // 3. SSMからPrometheus設定を取得
    const prometheusConfig = await getPrometheusConfig();

    // 4. config/services.jsonを取得
    const servicesConfig = await getConfigFromS3();

    // 5. Prometheusからデータを取得
    console.log('Fetching data from Prometheus...');
    const statusData = await fetchAllServiceStatus(prometheusConfig, servicesConfig.services);

    // 6. 新しいJSONを生成
    const newStatus = {
      lastUpdate: now.toISOString(),
      services: statusData
    };

    // 7. S3に保存
    await putStatusToS3(newStatus);

    console.log('Status updated successfully');

    // 8. 競合対策: S3から最新データを再取得して返す
    const latestStatus = await getStatusFromS3();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=300'
      },
      body: JSON.stringify({
        lastUpdate: latestStatus.lastUpdate,
        services: latestStatus.services
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Failed to update status',
        message: error.message
      })
    };
  }
};

/**
 * S3からstatus.jsonを取得
 */
async function getStatusFromS3() {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: 'data/status.json'
    });

    const response = await s3Client.send(command);
    const body = await streamToString(response.Body);
    return JSON.parse(body);
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      // ファイルが存在しない場合は初期値を返す
      return {
        lastUpdate: '2000-01-01T00:00:00Z',
        services: []
      };
    }
    throw error;
  }
}

/**
 * S3にstatus.jsonを保存
 */
async function putStatusToS3(status) {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'data/status.json',
    Body: JSON.stringify(status, null, 2),
    ContentType: 'application/json',
    CacheControl: 'max-age=60, s-maxage=180'
  });

  await s3Client.send(command);
}

/**
 * S3からconfig/services.jsonを取得
 */
async function getConfigFromS3() {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'config/services.json'
  });

  const response = await s3Client.send(command);
  const body = await streamToString(response.Body);
  return JSON.parse(body);
}

/**
 * SSMからPrometheus設定を取得
 */
async function getPrometheusConfig() {
  const [url, username, password] = await Promise.all([
    getSSMParameter(PROMETHEUS_URL_PARAM),
    getSSMParameter(PROMETHEUS_USERNAME_PARAM),
    getSSMParameter(PROMETHEUS_PASSWORD_PARAM)
  ]);

  return {
    url: url,
    auth: username && password ? {
      username: username,
      password: password
    } : undefined
  };
}

/**
 * SSM Parameterを取得
 */
async function getSSMParameter(name) {
  try {
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: true
    });

    const response = await ssmClient.send(command);
    return response.Parameter.Value;
  } catch (error) {
    console.warn(`Failed to get SSM parameter ${name}:`, error.message);
    return null;
  }
}

/**
 * 全サービスのステータスを取得
 */
async function fetchAllServiceStatus(prometheusConfig, services) {
  const promises = services.map(service => fetchServiceStatus(prometheusConfig, service));
  return await Promise.all(promises);
}

/**
 * 単一サービスのステータスを取得
 */
async function fetchServiceStatus(prometheusConfig, service) {
  try {
    const queries = Array.isArray(service.prometheusQuery)
      ? service.prometheusQuery
      : [service.prometheusQuery];

    // 各クエリを並列実行
    const results = await Promise.allSettled(
      queries.map(query => fetchPrometheusData(prometheusConfig, query))
    );

    // 成功したクエリの結果からステータスを判定
    const statuses = results
      .filter(r => r.status === 'fulfilled')
      .map(r => parsePrometheusResult(r.value));

    const mergedStatus = mergeStatuses(statuses.map(s => s.status));

    // レスポンスタイム取得（オプション）
    let responseTime;
    try {
      responseTime = await fetchResponseTime(prometheusConfig, service);
    } catch (error) {
      console.warn(`Could not fetch response time for ${service.id}:`, error.message);
    }

    // 履歴取得
    const history = await fetchStatusHistory(prometheusConfig, service);

    return {
      id: service.id,
      status: mergedStatus,
      responseTime: responseTime,
      lastChecked: new Date().toISOString(),
      incidents: [],
      history: history
    };
  } catch (error) {
    console.error(`Failed to fetch status for ${service.id}:`, error);
    return {
      id: service.id,
      status: 'unknown',
      lastChecked: new Date().toISOString(),
      incidents: [],
      history: []
    };
  }
}

/**
 * Prometheusからデータを取得
 */
async function fetchPrometheusData(config, query) {
  const baseUrl = config.url.replace(/\/$/, '');

  const headers = {};
  if (config.auth) {
    const credentials = Buffer.from(
      `${config.auth.username}:${config.auth.password}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const response = await axios.get(`${baseUrl}/api/v1/query`, {
    params: { query },
    headers,
    timeout: 10000
  });

  return response.data;
}

/**
 * Prometheusの結果をパース
 */
function parsePrometheusResult(result) {
  if (!result.data?.result || result.data.result.length === 0) {
    return { status: 'unknown', value: 0 };
  }

  const value = parseFloat(result.data.result[0].value[1]);

  // probe_success形式 (1 = up, 0 = down)
  if (value === 1 || value === 0) {
    return { status: value === 1 ? 'up' : 'down', value };
  }

  // HTTP status code形式
  if (value >= 200 && value < 300) {
    return { status: 'up', value };
  } else if (value === 0 || value >= 300) {
    return { status: 'down', value };
  }

  return { status: 'unknown', value };
}

/**
 * 複数のステータスをマージ
 */
function mergeStatuses(statuses) {
  if (statuses.length === 0) return 'unknown';
  if (statuses.some(s => s === 'up')) return 'up';
  if (statuses.some(s => s === 'degraded')) return 'degraded';
  if (statuses.every(s => s === 'down')) return 'down';
  return 'unknown';
}

/**
 * レスポンスタイムを取得
 */
async function fetchResponseTime(config, service) {
  const queryString = Array.isArray(service.prometheusQuery)
    ? service.prometheusQuery[0]
    : service.prometheusQuery;

  const instance = extractInstanceFromQuery(queryString);
  if (!instance) return undefined;

  const query = `probe_duration_seconds{instance="${instance}"}`;
  const result = await fetchPrometheusData(config, query);

  if (result.data?.result && result.data.result.length > 0) {
    const seconds = parseFloat(result.data.result[0].value[1]);
    return Math.round(seconds * 1000);
  }

  return undefined;
}

/**
 * クエリからinstanceを抽出
 */
function extractInstanceFromQuery(query) {
  const match = query.match(/instance="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * ステータス履歴を取得（過去3時間）
 */
async function fetchStatusHistory(config, service) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const threeHoursAgo = now - (3 * 60 * 60);
    const step = '5m';

    const query = Array.isArray(service.prometheusQuery)
      ? service.prometheusQuery[0]
      : service.prometheusQuery;

    const baseUrl = config.url.replace(/\/$/, '');

    const headers = {};
    if (config.auth) {
      const credentials = Buffer.from(
        `${config.auth.username}:${config.auth.password}`
      ).toString('base64');
      headers['Authorization'] = `Basic ${credentials}`;
    }

    const response = await axios.get(`${baseUrl}/api/v1/query_range`, {
      params: {
        query,
        start: threeHoursAgo,
        end: now,
        step
      },
      headers,
      timeout: 10000
    });

    if (!response.data?.data?.result || response.data.data.result.length === 0) {
      return [];
    }

    const values = response.data.data.result[0].values;
    return values.map(([timestamp, valueStr]) => {
      const value = parseFloat(valueStr);
      return {
        timestamp: new Date(timestamp * 1000).toISOString(),
        status: getStatusFromValue(value),
        value
      };
    });
  } catch (error) {
    console.warn(`Could not fetch history for ${service.id}:`, error.message);
    return [];
  }
}

/**
 * 数値からステータスを判定
 */
function getStatusFromValue(value) {
  if (value === 1 || value === 0) {
    return value === 1 ? 'up' : 'down';
  }
  if (value >= 200 && value < 300) {
    return 'up';
  } else if (value === 0 || value >= 300) {
    return 'down';
  }
  return 'unknown';
}

/**
 * StreamをStringに変換
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
