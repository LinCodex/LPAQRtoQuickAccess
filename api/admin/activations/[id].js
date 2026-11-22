// Vercel Serverless Function - Update/Delete activation
const {
  applyCors,
  verifyToken,
  validateId,
  validateLpaCode,
  validateStatus,
  sanitizeField
} = require('../../_lib/auth');
const { getRedisClient, closeRedisClient, isRedisUnavailableError } = require('../../_lib/redis');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'PUT,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { id } = req.query;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid activation ID' });
  }

  let redis;

  if (req.method === 'PUT') {
    const body = req.body || {};
    const { phoneNumber, notes, status, lpaCode, shortUrl } = body;

    if (lpaCode !== undefined && typeof lpaCode === 'string' && lpaCode.trim() && !validateLpaCode(lpaCode)) {
      return res.status(400).json({ error: 'Invalid LPA code format' });
    }

    if (status !== undefined && !validateStatus(status)) {
      return res.status(400).json({ error: 'Invalid activation status' });
    }

    try {
      redis = await getRedisClient();
      const activationData = await redis.get(`activation:${id}`);

      if (!activationData) {
        await closeRedisClient(redis);
        return res.status(404).json({ error: 'Activation not found' });
      }

      const activation = JSON.parse(activationData);

      const updatedActivation = {
        ...activation,
        phoneNumber: phoneNumber !== undefined ? sanitizeField(String(phoneNumber), 32) : activation.phoneNumber,
        notes: notes !== undefined ? sanitizeField(String(notes), 500) : activation.notes,
        lpaCode: lpaCode !== undefined ? (typeof lpaCode === 'string' ? lpaCode.trim() : '') : activation.lpaCode,
        shortUrl: shortUrl !== undefined ? sanitizeField(String(shortUrl), 256) : activation.shortUrl,
        updatedAt: new Date().toISOString(),
        updatedBy: user.username
      };

      if (status !== undefined) {
        updatedActivation.status = status;
      }

      await redis.set(`activation:${id}`, JSON.stringify(updatedActivation));
      await closeRedisClient(redis);

      return res.status(200).json(updatedActivation);
    } catch (error) {
      console.error('Error updating activation:', error);
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
      const activationData = await redis.get(`activation:${id}`);

      if (!activationData) {
        await closeRedisClient(redis);
        return res.status(404).json({ error: 'Activation not found' });
      }

      await redis.del(`activation:${id}`);
      await redis.sRem('activations', id);
      await closeRedisClient(redis);

      return res.status(200).json({ message: 'Activation deleted' });
    } catch (error) {
      console.error('Error deleting activation:', error);
      await closeRedisClient(redis);
      if (isRedisUnavailableError(error)) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
