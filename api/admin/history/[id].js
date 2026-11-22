// Vercel Serverless Function - Delete Single Generated eSIM History Entry
const {
  applyCors,
  verifyToken,
  validateId
} = require('../../_lib/auth');
const { getRedisClient, closeRedisClient, isRedisUnavailableError } = require('../../_lib/redis');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid history ID' });
  }

  let redis;
  try {
    redis = await getRedisClient();
    const existing = await redis.get(`history:esim:${id}`);
    if (!existing) {
      await closeRedisClient(redis);
      return res.status(404).json({ error: 'History entry not found' });
    }

    await redis.del(`history:esim:${id}`);
    await redis.sRem('history:esim:ids', id);
    await closeRedisClient(redis);

    return res.status(200).json({ message: 'History entry deleted' });
  } catch (error) {
    console.error('Error deleting history entry:', error);
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
