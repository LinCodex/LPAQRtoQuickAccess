// Vercel Serverless Function - Create short link
const crypto = require('crypto');
const { applyCors, validateLpaCode, getPublicBaseUrl } = require('../_lib/auth');
const { getRedisClient, closeRedisClient, isRedisUnavailableError } = require('../_lib/redis');

const BASE62_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateShortId() {
  const bytes = crypto.randomBytes(6);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += BASE62_ALPHABET.charAt(bytes[i] % BASE62_ALPHABET.length);
  }
  return result;
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET,POST,OPTIONS');

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
    redis = await getRedisClient();

    let shortId = generateShortId();
    let attempts = 0;

    while (await redis.exists(`shortlink:${shortId}`) && attempts < 10) {
      shortId = generateShortId();
      attempts++;
    }

    await redis.set(`shortlink:${shortId}`, normalizedLpa, { EX: 60 * 60 * 24 * 30 });
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
};
