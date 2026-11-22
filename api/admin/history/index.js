// Vercel Serverless Function - List / Create / Clear Generated eSIM History
const { v4: uuidv4 } = require('uuid');
const {
  applyCors,
  verifyToken,
  validateLpaCode,
  parseLpaParts,
  sanitizeField
} = require('../../_lib/auth');
const { getRedisClient, closeRedisClient, isRedisUnavailableError } = require('../../_lib/redis');

const HISTORY_MAX_ENTRIES = 500;

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET,POST,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let redis;

  if (req.method === 'GET') {
    try {
      redis = await getRedisClient();
      const ids = await redis.sMembers('history:esim:ids');

      if (!ids || ids.length === 0) {
        await closeRedisClient(redis);
        return res.status(200).json([]);
      }

      const rawList = await redis.mGet(ids.map((id) => `history:esim:${id}`));
      await closeRedisClient(redis);
      redis = null;

      const validItems = rawList
        .map((data) => (data ? JSON.parse(data) : null))
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.status(200).json(validItems);
    } catch (error) {
      console.error('Error listing history:', error);
      await closeRedisClient(redis);
      if (isRedisUnavailableError(error)) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const rawLpa = typeof body.lpaCode === 'string' ? body.lpaCode.trim() : '';
    const phoneNumber = sanitizeField(body.phoneNumber || '', 32);

    if (!rawLpa || !validateLpaCode(rawLpa)) {
      return res.status(400).json({ error: 'Valid LPA code is required' });
    }

    const parts = parseLpaParts(rawLpa);
    if (!parts) {
      return res.status(400).json({ error: 'Invalid LPA code format' });
    }

    try {
      redis = await getRedisClient();

      const id = uuidv4().split('-')[0];
      const entry = {
        id,
        lpaCode: rawLpa,
        smdpAddress: parts.smdpAddress,
        activationCode: parts.activationCode,
        confirmationCode: parts.confirmationCode,
        phoneNumber,
        createdAt: new Date().toISOString(),
        createdBy: user.username
      };

      await redis.set(`history:esim:${id}`, JSON.stringify(entry));
      await redis.sAdd('history:esim:ids', id);

      // Keep history bounded at 500 entries so Redis storage cannot grow unbounded
      const ids = await redis.sMembers('history:esim:ids');
      if (ids && ids.length > HISTORY_MAX_ENTRIES) {
        const rawList = await redis.mGet(ids.map((itemId) => `history:esim:${itemId}`));
        const staleIds = [];
        const entries = [];
        ids.forEach((itemId, idx) => {
          const raw = rawList[idx];
          if (!raw) {
            staleIds.push(itemId);
            return;
          }
          try {
            entries.push(JSON.parse(raw));
          } catch {
            staleIds.push(itemId);
          }
        });
        entries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const overflowIds = entries.slice(HISTORY_MAX_ENTRIES).map((item) => item.id);
        const toRemove = [...staleIds, ...overflowIds];
        if (toRemove.length > 0) {
          await Promise.all([
            ...toRemove.map((oldId) => redis.del(`history:esim:${oldId}`)),
            redis.sRem('history:esim:ids', toRemove)
          ]);
        }
      }

      await closeRedisClient(redis);
      return res.status(201).json(entry);
    } catch (error) {
      console.error('Error saving history entry:', error);
      await closeRedisClient(redis);
      if (isRedisUnavailableError(error)) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      redis = await getRedisClient();
      const ids = await redis.sMembers('history:esim:ids');
      if (ids && ids.length > 0) {
        await Promise.all(ids.map((id) => redis.del(`history:esim:${id}`)));
      }
      await redis.del('history:esim:ids');
      await closeRedisClient(redis);
      return res.status(200).json({ message: 'History cleared' });
    } catch (error) {
      console.error('Error clearing history:', error);
      await closeRedisClient(redis);
      if (isRedisUnavailableError(error)) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
