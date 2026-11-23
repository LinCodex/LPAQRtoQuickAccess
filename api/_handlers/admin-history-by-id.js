// Handler - Update / Delete Single Generated eSIM History Entry (authenticated)
import { applyCors, verifyToken, validateId } from '../_lib/auth.js';
import { getRedisClient, closeRedisClient, isRedisUnavailableError } from '../_lib/redis.js';

export default async function handler(req, res) {
  applyCors(req, res, 'PATCH,PUT,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const isUpdate = req.method === 'PATCH' || req.method === 'PUT';
  if (!isUpdate && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid history ID' });
  }

  let redis;
  try {
    redis = await getRedisClient();
    const raw = await redis.get(`history:esim:${id}`);
    if (!raw) {
      await closeRedisClient(redis);
      return res.status(404).json({ error: 'History entry not found' });
    }

    if (isUpdate) {
      const existing = JSON.parse(raw);
      let body = req.body || {};
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      const nextActivated = typeof body.activated === 'boolean' ? body.activated : !Boolean(existing.activated);
      const nowIso = new Date().toISOString();
      const updated = {
        ...existing,
        activated: nextActivated,
        activatedAt: nextActivated ? (existing.activated && existing.activatedAt ? existing.activatedAt : nowIso) : null,
        updatedAt: nowIso,
        updatedBy: user.username
      };

      await redis.set(`history:esim:${id}`, JSON.stringify(updated));
      await closeRedisClient(redis);
      return res.status(200).json(updated);
    }

    await redis.del(`history:esim:${id}`);
    await redis.sRem('history:esim:ids', id);
    await closeRedisClient(redis);

    return res.status(200).json({ message: 'History entry deleted' });
  } catch (error) {
    console.error('Error updating/deleting history entry:', error);
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
