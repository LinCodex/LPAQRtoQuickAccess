// Handler - List / Create / Clear Generated eSIM History (authenticated)
import { v4 as uuidv4 } from 'uuid';
import {
  applyCors,
  verifyToken,
  validateLpaCode,
  parseLpaParts,
  sanitizeField
} from '../_lib/auth.js';
import {
  getRedisConfig,
  getRedisClient,
  closeRedisClient,
  isRedisUnavailableError
} from '../_lib/redis.js';
import { HISTORY_MAX_ENTRIES, autoCleanupIfNeeded } from '../_lib/cleanup.js';

export default async function handler(req, res) {
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
      const { provider } = getRedisConfig();
      redis = await getRedisClient();

      const ids = await redis.sMembers('history:esim:ids');
      const staleIds = [];
      const entries = [];

      if (ids && ids.length > 0) {
        const rawList = await redis.mGet(ids.map((itemId) => `history:esim:${itemId}`));
        ids.forEach((itemId, idx) => {
          const raw = rawList[idx];
          if (!raw) {
            staleIds.push(itemId);
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              entries.push(parsed);
            } else {
              staleIds.push(itemId);
            }
          } catch {
            staleIds.push(itemId);
          }
        });
      }

      const matchingEntries = entries
        .filter((item) => {
          if (typeof item.smdpAddress === 'string' && typeof item.activationCode === 'string') {
            return (
              item.smdpAddress.trim().toLowerCase() === parts.smdpAddress.toLowerCase() &&
              item.activationCode.trim() === parts.activationCode &&
              String(item.confirmationCode || '').trim() === String(parts.confirmationCode || '').trim()
            );
          }
          return typeof item.lpaCode === 'string' && item.lpaCode.trim() === rawLpa;
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      if (matchingEntries.length > 0) {
        const primary = matchingEntries[0];
        const duplicateIds = matchingEntries.slice(1).map((item) => item.id).filter(Boolean);
        const updatedEntry = {
          ...primary,
          lpaCode: rawLpa,
          smdpAddress: parts.smdpAddress,
          activationCode: parts.activationCode,
          confirmationCode: parts.confirmationCode,
          phoneNumber: phoneNumber || primary.phoneNumber || '',
          activated: Boolean(primary.activated),
          activatedAt: primary.activated ? (primary.activatedAt || null) : null,
          updatedAt: new Date().toISOString()
        };

        await redis.set(`history:esim:${primary.id}`, JSON.stringify(updatedEntry));

        const cleanupIds = [...staleIds, ...duplicateIds];
        if (cleanupIds.length > 0) {
          await Promise.all([
            ...duplicateIds.map((dupId) => redis.del(`history:esim:${dupId}`)),
            redis.sRem('history:esim:ids', cleanupIds)
          ]);
        }

        await closeRedisClient(redis);
        return res.status(200).json(updatedEntry);
      }

      const id = uuidv4().split('-')[0];
      const entry = {
        id,
        lpaCode: rawLpa,
        smdpAddress: parts.smdpAddress,
        activationCode: parts.activationCode,
        confirmationCode: parts.confirmationCode,
        phoneNumber,
        activated: false,
        activatedAt: null,
        createdAt: new Date().toISOString(),
        createdBy: user.username
      };

      await redis.set(`history:esim:${id}`, JSON.stringify(entry));
      await redis.sAdd('history:esim:ids', id);

      const allEntries = [entry, ...entries];
      if (allEntries.length > HISTORY_MAX_ENTRIES || staleIds.length > 0) {
        allEntries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const overflowIds = allEntries.slice(HISTORY_MAX_ENTRIES).map((item) => item.id);
        const toRemove = [...staleIds, ...overflowIds];
        if (toRemove.length > 0) {
          await Promise.all([
            ...overflowIds.map((oldId) => redis.del(`history:esim:${oldId}`)),
            redis.sRem('history:esim:ids', toRemove)
          ]);
        }
      }

      await autoCleanupIfNeeded(redis, provider);
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
}
