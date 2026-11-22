// Vercel Serverless Function - Change Password
const bcrypt = require('bcryptjs');
const { applyCors, verifyToken } = require('../_lib/auth');
const { getRedisClient, closeRedisClient, isRedisUnavailableError } = require('../_lib/redis');

module.exports = async function handler(req, res) {
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

  let redis;
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    redis = await getRedisClient();

    const userData = await redis.get(`user:${user.username}`);
    if (!userData) {
      await closeRedisClient(redis);
      return res.status(404).json({ error: 'User record not found' });
    }

    const existingUser = JSON.parse(userData);
    if (!bcrypt.compareSync(currentPassword, existingUser.password)) {
      await closeRedisClient(redis);
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await redis.set(`user:${user.username}`, JSON.stringify({
      ...existingUser,
      id: user.id,
      username: user.username,
      password: hashedPassword,
      passwordSetByUser: true,
      updatedAt: new Date().toISOString()
    }));

    await closeRedisClient(redis);
    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
