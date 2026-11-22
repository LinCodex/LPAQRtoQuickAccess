// Handler - Manual Redis Storage Cleanup (authenticated POST)
import { applyCors, verifyToken } from '../_lib/auth.js';
import {
  getRedisConfig,
  getRedisClient,
  closeRedisClient,
  isRedisUnavailableError
} from '../_lib/redis.js';
import { runStorageCleanup } from '../_lib/cleanup.js';

export default async function handler(req, res) {
  applyCors(req, res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  res.setHeader('Cache-Control', 'no-store');
  let redis = null;

  try {
    const { provider } = getRedisConfig();
    redis = await getRedisClient({ timeoutMs: 4500 });
    const report = await runStorageCleanup(redis, {
      provider,
      reason: 'manual',
      force: true
    });
    await closeRedisClient(redis);
    redis = null;
    return res.status(200).json(report);
  } catch (error) {
    console.error('Error running storage cleanup:', error);
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
