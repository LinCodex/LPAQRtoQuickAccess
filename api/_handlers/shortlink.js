// Handler - Create short link
import crypto from 'node:crypto';
import { applyCors, validateLpaCode, getPublicBaseUrl, getClientIp, checkRateLimit } from '../_lib/auth.js';
import {
  getRedisConfig,
  getRedisClient,
  closeRedisClient,
  isRedisUnavailableError
} from '../_lib/redis.js';
import { autoCleanupIfNeeded } from '../_lib/cleanup.js';

const BASE62_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateShortId() {
  const bytes = crypto.randomBytes(6);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += BASE62_ALPHABET.charAt(bytes[i] % BASE62_ALPHABET.length);
  }
  return result;
}

export default async function handler(req, res) {
  applyCors(req, res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lpaCode } = req.body || {};

  if (!validateLpaCode(lpaCode)) {
    return res.status(400).json({ error: 'Invalid LPA code' });
  }

  const normalizedLpa = lpaCode.trim();
  let redis;

  try {
    const { provider } = getRedisConfig();
    redis = await getRedisClient();

    const ip = getClientIp(req);
    const rate = await checkRateLimit(redis, `ratelimit:shortlink:${ip}`, 30, 900);
    if (!rate.allowed) {
      await closeRedisClient(redis);
      return res.status(429).json({ error: 'Too many short link requests. Please try again shortly.' });
    }

    let shortId = generateShortId();
    let attempts = 0;

    while (await redis.exists(`shortlink:${shortId}`) && attempts < 10) {
      shortId = generateShortId();
      attempts++;
    }

    await redis.set(`shortlink:${shortId}`, normalizedLpa, { EX: 60 * 60 * 24 * 30 });
    await autoCleanupIfNeeded(redis, provider);
    await closeRedisClient(redis);

    const domain = getPublicBaseUrl(req);

    return res.status(201).json({
      shortId,
      shortUrl: `${domain}/s/${shortId}`,
      lpaCode: normalizedLpa
    });
  } catch (error) {
    console.error('Error creating short link:', error);
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
