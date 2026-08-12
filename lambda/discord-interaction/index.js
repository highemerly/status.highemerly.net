/**
 * Discord の /announce を受けて、S3 の data/announcements.json を更新する。
 *
 * 当初は GitHub の repository_dispatch を経由してリポジトリにファイルを
 * 作らせていたが、経路が長いわりに得るものが少なかったのでやめた。
 * その構成の動機は「Bot が S3 に書くと CloudFront のキャッシュが消えない」
 * という旧実装の問題だったが、それは s-maxage を短くした時点で解決している。
 *
 * data/ は Lambda が書く領域で、GitHub Actions 側は IAM で書き込みを
 * 拒否してある。お知らせもここに置くことで、書き手が 1 つに定まる。
 *
 * 旧実装からの変更点:
 *  - ワーカー Lambda を廃止し 1 本にした
 *  - CloudFront invalidation をやめた。s-maxage=60 で 1 分以内に反映される
 *  - 依存パッケージをなくした。署名検証は Node 標準の Ed25519 を使う
 */

const crypto = require('node:crypto');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const s3Client = new S3Client({ region: REGION });
const ssmClient = new SSMClient({ region: REGION });

const S3_BUCKET = process.env.S3_BUCKET || 'status-highemerly-net';
const ANNOUNCEMENTS_KEY = process.env.ANNOUNCEMENTS_KEY || 'data/announcements.json';
const PUBLIC_KEY_PARAM = process.env.DISCORD_PUBLIC_KEY_PARAM || '/status-page/discord/public-key';

// 溜め込むと配信サイズが増えるだけなので上限を設ける
const MAX_ANNOUNCEMENTS = 20;

// 署名の使い回しを防ぐ。Discord の署名対象にはタイムスタンプが含まれる
const MAX_SIGNATURE_AGE_SECONDS = 300;

const LEVELS = ['info', 'maintenance', 'incident'];

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
const InteractionResponseType = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4 };

/** Ed25519 の生の公開鍵 32 バイトに付ける SPKI ヘッダ */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

let cachedPublicKey = null;

exports.handler = async (event) => {
  const startedAt = Date.now();

  try {
    const headers = event.headers || {};
    const signature = headers['x-signature-ed25519'] || headers['X-Signature-Ed25519'];
    const timestamp = headers['x-signature-timestamp'] || headers['X-Signature-Timestamp'];

    if (!signature || !timestamp) {
      console.warn('署名ヘッダがありません:', Object.keys(headers).join(', '));
      return { statusCode: 401, body: 'missing signature' };
    }

    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) {
      console.warn(`署名が古すぎます: ${age}s`);
      return { statusCode: 401, body: 'stale signature' };
    }

    // API Gateway の設定によっては本文が base64 で渡る。
    // 署名は元のバイト列に対して付いているので、必ず戻してから検証する。
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    if (!(await verifySignature(body, signature, timestamp))) {
      console.warn('署名の検証に失敗しました');
      return { statusCode: 401, body: 'invalid signature' };
    }

    console.log(`[${Date.now() - startedAt}ms] 署名検証まで完了`);

    const interaction = JSON.parse(body);

    // Discord のエンドポイント検証
    if (interaction.type === InteractionType.PING) {
      return reply({ type: InteractionResponseType.PONG });
    }

    if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
      return { statusCode: 400, body: 'unsupported interaction' };
    }

    if (interaction.data.name !== 'announce') {
      return message(`不明なコマンドです: ${interaction.data.name}`);
    }

    const result = await handleAnnounce(interaction);
    console.log(`[${Date.now() - startedAt}ms] 完了`);
    return result;
  } catch (error) {
    console.error('Handler error:', error);
    // 例外時も Discord には必ず何か返す。無言だと「応答しませんでした」になる
    return message(`エラーが発生しました: ${error.message}`);
  }
};

/* ------------------------------------------------------------------ *
 * /announce
 * ------------------------------------------------------------------ */

async function handleAnnounce(interaction) {
  const options = {};
  for (const option of interaction.data.options || []) {
    options[option.name] = option.value;
  }

  const author =
    interaction.member?.user?.username || interaction.user?.username || 'unknown';

  const current = await loadAnnouncements();

  if (options.action === 'delete') {
    if (!options.id) return message('削除するお知らせの id を指定してください。');

    const remaining = current.filter((item) => item.id !== options.id);
    if (remaining.length === current.length) {
      const ids = current.map((item) => `\`${item.id}\``).join(', ') || 'なし';
      return message(`\`${options.id}\` は見つかりませんでした。\n現在のお知らせ: ${ids}`);
    }

    await saveAnnouncements(remaining);
    console.log(`削除: ${options.id} by ${author}`);
    return message(`お知らせを削除しました。1 分以内に反映されます。\nhttps://status.highemerly.net/`);
  }

  if (options.action !== 'create') {
    return message(`不明なアクションです: ${options.action}`);
  }

  const title = oneLine(options.title || '');
  if (!title) return message('title は必須です。');

  const level = options.level || 'info';
  // Discord 側でも選択肢に限定しているが、念のため
  if (!LEVELS.includes(level)) return message(`level が不正です: ${level}`);

  const entry = {
    id: makeId(),
    level,
    title: { ja: title },
    publishedAt: new Date().toISOString(),
  };

  const titleEn = oneLine(options.title_en || '');
  if (titleEn) entry.title.en = titleEn;

  const body = multiLine(options.body || '');
  const bodyEn = multiLine(options.body_en || '');
  if (body || bodyEn) {
    entry.body = {};
    if (body) entry.body.ja = body;
    if (bodyEn) entry.body.en = bodyEn;
  }

  if (options.category) entry.categoryId = options.category;

  // 新しいものが上。件数の上限で古いものから落とす
  const next = [entry, ...current].slice(0, MAX_ANNOUNCEMENTS);
  await saveAnnouncements(next);

  console.log(`追加: ${entry.id} by ${author}`);
  return message(
    `お知らせを公開しました。1 分以内に反映されます。\n` +
    `id: \`${entry.id}\`（削除するときに使います）\n` +
    `https://status.highemerly.net/`
  );
}

/** 一覧の識別子。英小文字・数字・ハイフンのみで構成する */
function makeId() {
  return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '').toLowerCase();
}

/* ------------------------------------------------------------------ *
 * S3
 * ------------------------------------------------------------------ */

/**
 * 現在のお知らせを読む。
 *
 * 読んで書き戻すので、同時に 2 つのコマンドが走ると後勝ちになる。
 * 運用者 1 人・月に数回という頻度なので、条件付き書き込みまでは入れていない。
 */
async function loadAnnouncements() {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: ANNOUNCEMENTS_KEY })
    );
    const parsed = JSON.parse(await response.Body.transformToString());
    return Array.isArray(parsed.announcements) ? parsed.announcements : [];
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.name === 'NotFound') return [];
    throw error;
  }
}

async function saveAnnouncements(announcements) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: ANNOUNCEMENTS_KEY,
      Body: JSON.stringify({ announcements }),
      ContentType: 'application/json',
      // invalidation は使わない。60 秒で入れ替わる
      CacheControl: 'public, max-age=60, s-maxage=60',
    })
  );
}

/* ------------------------------------------------------------------ *
 * 入力の整形
 * ------------------------------------------------------------------ */

/** 見出しは 1 行。改行と制御文字を潰す */
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

/* ------------------------------------------------------------------ *
 * 署名検証
 * ------------------------------------------------------------------ */

/**
 * Discord の Ed25519 署名を検証する。
 *
 * tweetnacl は使わない。Node は標準で Ed25519 を検証でき、
 * 依存を持たなければ zip を作らずコンソールに貼るだけで済む。
 */
async function verifySignature(body, signature, timestamp) {
  try {
    const publicKeyHex = await getPublicKey();
    if (!publicKeyHex) {
      console.error(`公開鍵が取得できません: ${PUBLIC_KEY_PARAM}`);
      return false;
    }

    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(
      null,
      Buffer.from(timestamp + body),
      key,
      Buffer.from(signature, 'hex')
    );
  } catch (error) {
    console.error('Signature verification error:', error.message);
    return false;
  }
}

async function getPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;

  const response = await ssmClient.send(
    new GetParameterCommand({ Name: PUBLIC_KEY_PARAM, WithDecryption: true })
  );
  cachedPublicKey = response.Parameter.Value;
  return cachedPublicKey;
}

/* ------------------------------------------------------------------ *
 * 応答
 * ------------------------------------------------------------------ */

function reply(payload) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function message(content) {
  return reply({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content },
  });
}
