/**
 * Discord の /announce を受けて、GitHub に repository_dispatch を送る。
 *
 * この関数は S3 にも CloudFront にも触らない。お知らせの正本は
 * リポジトリの content/announcements/ で、実際にファイルを作るのは
 * announce ワークフロー。Bot は「GitHub を叩くだけ」に徹する。
 *
 * 旧実装からの変更点:
 *  - ワーカー Lambda を廃止し 1 本にした。S3 書き込みと CloudFront
 *    invalidation が不要になったため
 *  - 呼び出しを await するようにした。旧実装は Promise を await せずに
 *    return しており、Lambda が実行環境を凍結して処理が消えることがあった
 *    （「反応するときとしないときがある」の原因）
 *  - 依存パッケージをなくした。署名検証は Node 標準の Ed25519、
 *    HTTP は標準 fetch。zip を作らずコンソールに貼るだけで動く
 */

const crypto = require('node:crypto');
const { SSMClient, GetParametersCommand } = require('@aws-sdk/client-ssm');

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const ssmClient = new SSMClient({ region: REGION });

const GITHUB_REPO = process.env.GITHUB_REPO || 'highemerly/status.highemerly.net';
const PUBLIC_KEY_PARAM = process.env.DISCORD_PUBLIC_KEY_PARAM || '/status-page/discord/public-key';
const GITHUB_TOKEN_PARAM = process.env.GITHUB_TOKEN_PARAM || '/status-page/github/token';

// 署名の使い回しを防ぐ。Discord の署名対象にはタイムスタンプが含まれる
const MAX_SIGNATURE_AGE_SECONDS = 300;

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
const InteractionResponseType = { PONG: 1, CHANNEL_MESSAGE_WITH_SOURCE: 4 };

/** Ed25519 の生の公開鍵 32 バイトに付ける SPKI ヘッダ */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// コンテナが再利用される間は SSM を引き直さない。
// この関数は呼ばれる頻度が低くコールドスタートが主なので、
// 温まっている間だけでも減らしておく
let cachedSecrets = null;

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

    return await handleAnnounce(interaction);
  } catch (error) {
    console.error('Handler error:', error);
    // 例外時も Discord には必ず何か返す。無言だと「応答しませんでした」になる
    return message('エラーが発生しました。ログを確認してください。');
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

  const action = options.action;
  const author =
    interaction.member?.user?.username || interaction.user?.username || 'unknown';

  let payload;

  if (action === 'create') {
    if (!options.title) return message('title は必須です。');

    payload = {
      action: 'create',
      id: makeId(),
      // client_payload の最上位プロパティは 10 個までという制限があるため、
      // 中身はここにまとめる（超えると GitHub が 422 を返す）
      announcement: {
        level: options.level || 'info',
        category: options.category || '',
        title: options.title,
        titleEn: options.title_en || '',
        body: options.body || '',
        bodyEn: options.body_en || '',
        publishedAt: new Date().toISOString(),
      },
      author,
    };
  } else if (action === 'delete') {
    if (!options.id) return message('削除するお知らせの id を指定してください。');
    payload = { action: 'delete', id: options.id, author };
  } else {
    return message(`不明なアクションです: ${action}`);
  }

  // 結果を返信できるよう、インタラクションの識別子も渡す。
  // ワークフローが最後にこのメッセージを書き換える
  payload.discord = {
    applicationId: interaction.application_id,
    interactionToken: interaction.token,
  };

  // ここを await しないと、Lambda が return した瞬間に実行環境が凍結され、
  // 送信が完了していない場合そのまま失われる（旧実装の不具合）
  await dispatchToGitHub(payload);

  return message(
    action === 'create'
      ? `お知らせを送信しました。\nid: \`${payload.id}\`（削除するときに使います）`
      : `お知らせ \`${payload.id}\` の削除を送信しました。`
  );
}

/** ファイル名になる。英小文字・数字・ハイフンのみで構成する */
function makeId() {
  return new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '').toLowerCase();
}

async function dispatchToGitHub(payload) {
  const { githubToken: token } = await getSecrets();
  if (!token) throw new Error(`GitHub token not found at ${GITHUB_TOKEN_PARAM}`);

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'status-page-discord-bot',
    },
    body: JSON.stringify({ event_type: 'announcement', client_payload: payload }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`GitHub dispatch failed: ${response.status} ${detail.slice(0, 200)}`);
  }

  console.log(`Dispatched ${payload.action} ${payload.id} by ${payload.author}`);
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
    const { publicKey: publicKeyHex } = await getSecrets();
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

/* ------------------------------------------------------------------ *
 * 応答と設定
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

/**
 * 必要な秘密を 1 回の呼び出しでまとめて取る。
 *
 * 公開鍵は署名検証、トークンは GitHub 呼び出しで使う。別々に引くと
 * SSM への往復が 2 回になる。この関数はコールドスタートが主なので、
 * 1 往復ぶんの短縮がそのまま Discord の 3 秒制限の余裕になる。
 */
async function getSecrets() {
  if (cachedSecrets) return cachedSecrets;

  const response = await ssmClient.send(
    new GetParametersCommand({
      Names: [PUBLIC_KEY_PARAM, GITHUB_TOKEN_PARAM],
      WithDecryption: true,
    })
  );

  if (response.InvalidParameters?.length) {
    console.error(`SSM に無いパラメータ: ${response.InvalidParameters.join(', ')}`);
  }

  const byName = Object.fromEntries(
    (response.Parameters || []).map((p) => [p.Name, p.Value])
  );

  cachedSecrets = {
    publicKey: byName[PUBLIC_KEY_PARAM] || null,
    githubToken: byName[GITHUB_TOKEN_PARAM] || null,
  };
  return cachedSecrets;
}
