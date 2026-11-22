const { createClient } = require('redis');

const DEFAULT_CONNECT_TIMEOUT_MS = 4500;
const AVAILABILITY_ERROR_CODES = new Set([
  'REDIS_NOT_CONFIGURED',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN'
]);

/**
 * Resolve Redis connection URL and provider label from environment variables.
 * Never returns or logs raw credentials externally.
 */
function getRedisConfig() {
  const candidates = [
    ['REDIS_URL', process.env.REDIS_URL],
    ['KV_URL', process.env.KV_URL]
  ];

  for (const [envVar, raw] of candidates) {
    if (typeof raw === 'string' && raw.trim()) {
      const url = raw.trim();
      const lower = url.toLowerCase();
      const provider = lower.includes('upstash.io') || lower.includes('upstash')
        ? 'Upstash Redis'
        : 'Redis';
      return { url, envVar, provider };
    }
  }

  return { url: null, envVar: null, provider: 'Redis' };
}

/**
 * Connect a Redis client with bounded timeout and safe error listener.
 */
async function getRedisClient(opts = {}) {
  const { url } = getRedisConfig();
  if (!url) {
    const err = new Error('Redis database is not configured');
    err.code = 'REDIS_NOT_CONFIGURED';
    throw err;
  }

  const client = createClient({
    url,
    socket: {
      connectTimeout: opts.timeoutMs || DEFAULT_CONNECT_TIMEOUT_MS,
      reconnectStrategy: false
    }
  });

  // Prevent unhandled EventEmitter 'error' crashes in serverless functions.
  client.on('error', () => {});
  await client.connect();
  return client;
}

/**
 * Gracefully close a Redis client without throwing if already disconnected.
 */
async function closeRedisClient(client) {
  if (!client) return;
  try {
    if (client.isOpen) {
      await client.quit();
    } else {
      await client.disconnect().catch(() => {});
    }
  } catch {
    await client.disconnect().catch(() => {});
  }
}

/**
 * Identify errors caused by missing Redis config or unreachable sockets.
 */
function isRedisUnavailableError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.code && AVAILABILITY_ERROR_CODES.has(String(err.code))) {
    return true;
  }
  const msg = String(err.message || '');
  return (
    msg.includes('REDIS_NOT_CONFIGURED') ||
    msg.includes('Connection timeout') ||
    msg.includes('Socket closed unexpectedly') ||
    msg.includes('The client is closed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  );
}

module.exports = {
  getRedisConfig,
  getRedisClient,
  closeRedisClient,
  isRedisUnavailableError
};
