// Handler - Get short link data
import { applyCors, validateId, validateLpaCode } from '../_lib/auth.js';
import { getRedisClient, closeRedisClient, isRedisUnavailableError } from '../_lib/redis.js';

export default async function handler(req, res) {
  applyCors(req, res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid short link ID' });
  }

  let redis;

  try {
    redis = await getRedisClient();
    const lpaCode = await redis.get(`shortlink:${id}`);
    await closeRedisClient(redis);

    if (!lpaCode || !validateLpaCode(lpaCode)) {
      return res.status(404).json({ error: 'Short link not found or expired' });
    }

    const activationUrl = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaCode.trim())}`;

    return res.status(200).json({
      lpaCode: lpaCode.trim(),
      activationUrl
    });
  } catch (error) {
    console.error('Error fetching short link:', error);
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
