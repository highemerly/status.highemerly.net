/**
 * DiscordCommandWorkerFunction
 *
 * Discord コマンドの実処理を行い、follow-upメッセージを送信
 */

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const axios = require('axios');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const cloudFrontClient = new CloudFrontClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });

const S3_BUCKET = process.env.S3_BUCKET;
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID;

/**
 * Lambda Handler
 */
exports.handler = async (event) => {
  const startTime = Date.now();

  try {
    console.log('Worker event:', JSON.stringify(event));

    const { interaction, commandName } = event;

    console.log(`[${Date.now() - startTime}ms] Processing ${commandName} command`);

    // まずDiscordに「処理中...」を送信（tokenの有効期限内に）
    await sendFollowUpMessage(interaction, '⏳ 処理中...');
    console.log(`[${Date.now() - startTime}ms] Sent initial response`);

    // S3からmessages.jsonを取得
    const messagesCache = await getMessagesFromS3();
    console.log(`[${Date.now() - startTime}ms] Loaded messages from S3`);

    // コマンド処理
    let responseMessage;
    if (commandName === 'announce') {
      responseMessage = await handleAnnounceCommand(interaction, messagesCache, startTime);
    } else if (commandName === 'status') {
      responseMessage = await handleStatusCommand(interaction, messagesCache, startTime);
    } else {
      responseMessage = '❌ 不明なコマンドです';
    }

    // S3に保存
    await putMessagesToS3(messagesCache);
    console.log(`[${Date.now() - startTime}ms] Saved to S3`);

    // Discordのメッセージを最終結果に更新
    await updateFollowUpMessage(interaction, responseMessage);
    console.log(`[${Date.now() - startTime}ms] Updated to final message`);

    // CloudFront invalidation
    try {
      const invalidationId = await invalidateCloudFrontCache('/data/messages.json');
      console.log(`[${Date.now() - startTime}ms] CloudFront invalidation completed: ${invalidationId}`);
    } catch (err) {
      console.error(`[${Date.now() - startTime}ms] CloudFront invalidation failed:`, err);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };

  } catch (error) {
    console.error('Worker error:', error);

    // エラーが発生した場合もメッセージを更新（すでに初期メッセージを送信済みの場合）
    try {
      if (event.interaction) {
        await updateFollowUpMessage(event.interaction, `❌ エラーが発生しました: ${error.message}`);
      }
    } catch (updateError) {
      console.error('Failed to update error message:', updateError);
      // 最初のPATCHが失敗している場合、ここも失敗する可能性が高い
    }

    throw error;
  }
};

/**
 * /announce コマンドを処理
 */
async function handleAnnounceCommand(interaction, messagesCache, startTime) {
  const options = {};
  if (interaction.data.options) {
    for (const option of interaction.data.options) {
      options[option.name] = option.value;
    }
  }

  const categoryId = options.category;
  const action = options.action;
  const message = options.message;

  console.log(`[${Date.now() - startTime}ms] Announce: category=${categoryId}, action=${action}`);

  if (!categoryId || !action) {
    return '❌ カテゴリとアクションは必須です';
  }

  if (action === 'create' && !message) {
    return '❌ createアクションにはメッセージが必要です';
  }

  if (action === 'create') {
    createMessage(messagesCache, categoryId, message, interaction.member?.user?.username || 'Discord User');
    return `✅ 完了しました！メッセージを追加しました\n\n🔗 https://status.highemerly.net/`;
  } else if (action === 'delete') {
    const deletedCount = deleteMessages(messagesCache, categoryId);
    return `✅ 完了しました！メッセージを${deletedCount}件削除しました\n\n🔗 https://status.highemerly.net/`;
  } else {
    return '❌ 不明なアクションです';
  }
}

/**
 * /status コマンドを処理
 */
async function handleStatusCommand(interaction, messagesCache, startTime) {
  const options = {};
  if (interaction.data.options) {
    for (const option of interaction.data.options) {
      options[option.name] = option.value;
    }
  }

  const categoryId = options.category;
  const action = options.action;
  const status = options.status;

  console.log(`[${Date.now() - startTime}ms] Status: category=${categoryId}, action=${action}, status=${status}`);

  if (!categoryId || !action) {
    return '❌ カテゴリとアクションは必須です';
  }

  if (action === 'override' && !status) {
    return '❌ overrideアクションにはステータスが必要です';
  }

  if (action === 'override') {
    setStatusOverride(messagesCache, categoryId, status, interaction.member?.user?.username || 'Discord User');
    const statusIcon = status === 'operational' ? '✅' : status === 'degraded' ? '⚠️' : '🔴';
    return `${statusIcon} 完了しました！ステータスを **${status}** に設定しました\n\n🔗 https://status.highemerly.net/`;
  } else if (action === 'clear') {
    const cleared = clearStatusOverride(messagesCache, categoryId);
    if (cleared) {
      return `✅ 完了しました！ステータスオーバーライドを解除しました\n\n🔗 https://status.highemerly.net/`;
    } else {
      return `ℹ️ ステータスオーバーライドは設定されていませんでした\n\n🔗 https://status.highemerly.net/`;
    }
  } else {
    return '❌ 不明なアクションです';
  }
}

/**
 * メッセージを追加
 */
function createMessage(messagesCache, categoryId, content, author) {
  const messageType = determineMessageType(content);

  const newMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    categoryId: categoryId,
    content: content,
    timestamp: new Date().toISOString(),
    author: author,
    type: messageType,
    pinned: false
  };

  messagesCache.messages.unshift(newMessage);

  if (messagesCache.messages.length > 100) {
    messagesCache.messages = messagesCache.messages.slice(0, 100);
  }
}

/**
 * メッセージを削除
 */
function deleteMessages(messagesCache, categoryId) {
  const initialLength = messagesCache.messages.length;
  messagesCache.messages = messagesCache.messages.filter(m => m.categoryId !== categoryId);
  return initialLength - messagesCache.messages.length;
}

/**
 * ステータスオーバーライドを設定
 */
function setStatusOverride(messagesCache, categoryId, status, author) {
  if (!messagesCache.statusOverrides) {
    messagesCache.statusOverrides = {};
  }

  messagesCache.statusOverrides[categoryId] = {
    status: status,
    timestamp: new Date().toISOString(),
    author: author
  };
}

/**
 * ステータスオーバーライドを解除
 */
function clearStatusOverride(messagesCache, categoryId) {
  if (!messagesCache.statusOverrides || !messagesCache.statusOverrides[categoryId]) {
    return false;
  }

  delete messagesCache.statusOverrides[categoryId];
  return true;
}

/**
 * メッセージタイプを判定
 */
function determineMessageType(content) {
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes('incident') || lowerContent.includes('outage')) {
    return 'incident';
  }

  if (lowerContent.includes('maintenance') || lowerContent.includes('scheduled')) {
    return 'maintenance';
  }

  if (lowerContent.includes('warning') || lowerContent.includes('degraded')) {
    return 'warning';
  }

  return 'info';
}

/**
 * S3からmessages.jsonを取得
 */
async function getMessagesFromS3() {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: 'data/messages.json'
    });

    const response = await s3Client.send(command);
    const body = await streamToString(response.Body);
    const data = JSON.parse(body);

    if (!data.statusOverrides) {
      data.statusOverrides = {};
    }

    return data;
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return { messages: [], statusOverrides: {} };
    }
    throw error;
  }
}

/**
 * S3にmessages.jsonを保存
 */
async function putMessagesToS3(messagesCache) {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'data/messages.json',
    Body: JSON.stringify(messagesCache, null, 2),
    ContentType: 'application/json',
    CacheControl: 'max-age=30, s-maxage=86400'
  });

  await s3Client.send(command);
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

/**
 * CloudFrontのキャッシュを無効化
 */
async function invalidateCloudFrontCache(path) {
  if (!CLOUDFRONT_DISTRIBUTION_ID) {
    console.warn('CLOUDFRONT_DISTRIBUTION_ID not set, skipping cache invalidation');
    return null;
  }

  try {
    const command = new CreateInvalidationCommand({
      DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
      InvalidationBatch: {
        CallerReference: `discord-worker-${Date.now()}`,
        Paths: {
          Quantity: 1,
          Items: [path]
        }
      }
    });

    const response = await cloudFrontClient.send(command);
    return response.Invalidation.Id;
  } catch (error) {
    console.error(`Failed to invalidate CloudFront cache for ${path}:`, error);
    throw error;
  }
}

/**
 * Discord Webhookで original interaction response を編集
 * Deferredレスポンス後、最初のメッセージは original response を編集する必要がある
 */
async function sendFollowUpMessage(interaction, message) {
  const applicationId = interaction.application_id;
  const token = interaction.token;
  // Deferredレスポンス後は @original を編集する
  const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;

  try {
    await axios.patch(webhookUrl, {
      content: message
    });
  } catch (error) {
    console.error('Failed to edit original response:', error);
    throw error;
  }
}

/**
 * Discord メッセージを更新（sendFollowUpMessageと同じだが、ログメッセージを変えるため）
 */
async function updateFollowUpMessage(interaction, message) {
  const applicationId = interaction.application_id;
  const token = interaction.token;
  const webhookUrl = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;

  try {
    await axios.patch(webhookUrl, {
      content: message
    });
  } catch (error) {
    console.error('Failed to update message:', error);
    throw error;
  }
}
