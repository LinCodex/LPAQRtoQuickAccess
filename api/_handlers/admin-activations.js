// Handler - List/Create activations (authenticated)
import { v4 as uuidv4 } from 'uuid';
import {
  applyCors,
  verifyToken,
  validateLpaCode,
  validateStatus,
  sanitizeField
} from '../_lib/auth.js';
import {
  getRedisConfig,
  getRedisClient,
  closeRedisClient,
  isRedisUnavailableError
} from '../_lib/redis.js';
import { autoCleanupIfNeeded } from '../_lib/cleanup.js';

export default async function handler(req, res) {
  applyCors(req, res, 'GET,POST,OPTIONS');

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
      const activationIds = await redis.sMembers('activations');

      if (!activationIds || activationIds.length === 0) {
        await closeRedisClient(redis);
        return res.status(200).json([]);
      }

      const rawList = await redis.mGet(activationIds.map((id) => `activation:${id}`));
      await closeRedisClient(redis);
      redis = null;

      const validActivations = rawList
        .map((data) => (data ? JSON.parse(data) : null))
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.status(200).json(validActivations);
    } catch (error) {
      console.error('Error listing activations:', error);
      await closeRedisClient(redis);
      if (isRedisUnavailableError(error)) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const phoneNumber = sanitizeField(body.phoneNumber || '', 32);
    const notes = sanitizeField(body.notes || '', 500);
    const rawLpa = typeof body.lpaCode === 'string' ? body.lpaCode.trim() : '';
    const requestedStatus =
      typeof body.status === 'string' && body.status ? body.status : (rawLpa ? 'active' : 'standby');

    if (rawLpa && !validateLpaCode(rawLpa)) {
      return res.status(400).json({ error: 'Invalid LPA code format' });
    }

    if (!validateStatus(requestedStatus)) {
      return res.status(400).json({ error: 'Invalid activation status' });
    }

    try {
      const { provider } = getRedisConfig();
      redis = await getRedisClient();

      const id = uuidv4().split('-')[0];
      const now = new Date().toISOString();
      const activation = {
        id,
        phoneNumber,
        notes,
        status: requestedStatus,
        lpaCode: rawLpa,
        createdAt: now,
        updatedAt: now,
        createdBy: user.username
      };

      await redis.set(`activation:${id}`, JSON.stringify(activation));
      await redis.sAdd('activations', id);
      await autoCleanupIfNeeded(redis, provider);

      await closeRedisClient(redis);
      return res.status(201).json(activation);
    } catch (error) {
      console.error('Error creating activation:', error);
      await closeRedisClient(redis);
      if (isRedisUnavailableError(error)) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
