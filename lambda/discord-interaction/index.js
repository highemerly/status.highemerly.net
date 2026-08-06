/**
 * HandleDiscordInteractionFunction
 *
 * Discord Slash Commandを処理してDeferred Responseを返し、ワーカーLambdaを呼び出す
 */

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const nacl = require('tweetnacl');

const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });

const DISCORD_PUBLIC_KEY_PARAM = process.env.DISCORD_PUBLIC_KEY_PARAM || '/status-page/discord/public-key';
const WORKER_LAMBDA_NAME = process.env.WORKER_LAMBDA_NAME || 'DiscordCommandWorkerFunction';

// Discord Public Keyをキャッシュ
let cachedPublicKey = null;

// Discord Interaction Types
const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2
};

// Discord Interaction Response Types
const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5
};

/**
 * Lambda Handler
 */
exports.handler = async (event, context) => {
  const startTime = Date.now();

  try {
    console.log('Event:', JSON.stringify(event));

    // 1. Discord署名を検証
    if (!event.headers) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing headers' })
      };
    }

    const signature = event.headers['x-signature-ed25519'] || event.headers['X-Signature-Ed25519'];
    const timestamp = event.headers['x-signature-timestamp'] || event.headers['X-Signature-Timestamp'];
    const body = event.body;

    if (!signature || !timestamp) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing signature headers' })
      };
    }

    console.log(`[${Date.now() - startTime}ms] Headers validated`);

    // Public Keyをキャッシュから取得（初回のみSSMから取得）
    if (!cachedPublicKey) {
      console.log('Fetching public key from SSM...');
      cachedPublicKey = await getSSMParameter(DISCORD_PUBLIC_KEY_PARAM);
      console.log(`[${Date.now() - startTime}ms] Public key fetched`);
      if (!cachedPublicKey) {
        console.error('Discord public key not found in SSM');
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Configuration error' })
        };
      }
    }
    const publicKey = cachedPublicKey;

    const isValid = verifyDiscordSignature(body, signature, timestamp, publicKey);
    console.log(`[${Date.now() - startTime}ms] Signature verified`);
    if (!isValid) {
      console.error('Invalid Discord signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    // 2. リクエストボディをパース
    const interaction = JSON.parse(body);
    console.log(`[${Date.now() - startTime}ms] Body parsed`);

    // 3. PING対応（Discord検証用）
    if (interaction.type === InteractionType.PING) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: InteractionResponseType.PONG })
      };
    }

    // 4. APPLICATION_COMMAND処理
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      console.log(`[${Date.now() - startTime}ms] Received command: ${interaction.data.name}`);

      // ワーカーLambdaを非同期呼び出し（await しない）
      const commandName = interaction.data.name;
      invokeWorkerLambda(interaction, commandName)
        .then(() => {
          console.log(`[${Date.now() - startTime}ms] Worker Lambda invoked successfully`);
        })
        .catch(err => {
          console.error(`[${Date.now() - startTime}ms] Worker Lambda invocation failed:`, err);
        });

      // 即座にDeferred Responseを返す
      console.log(`[${Date.now() - startTime}ms] Returning deferred response`);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
        })
      };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Unknown interaction type' })
    };

  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal server error'
      })
    };
  }
};

/**
 * ワーカーLambdaを非同期呼び出し
 */
async function invokeWorkerLambda(interaction, commandName) {
  const payload = {
    interaction,
    commandName
  };

  const command = new InvokeCommand({
    FunctionName: WORKER_LAMBDA_NAME,
    InvocationType: 'Event', // 非同期呼び出し
    Payload: JSON.stringify(payload)
  });

  await lambdaClient.send(command);
}

/**
 * Discord署名を検証
 */
function verifyDiscordSignature(body, signature, timestamp, publicKey) {
  try {
    const message = timestamp + body;
    const isValid = nacl.sign.detached.verify(
      Buffer.from(message),
      Buffer.from(signature, 'hex'),
      Buffer.from(publicKey, 'hex')
    );
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
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
    console.error(`Failed to get SSM parameter ${name}:`, error);
    return null;
  }
}
