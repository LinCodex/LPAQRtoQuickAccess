// Vercel Serverless Function - Reset Password using configured reset token
const bcrypt = require('bcryptjs');
const {
  applyCors,
  getClientIp,
  checkRateLimit,
  timingSafeCompare
} = require('../_lib/auth');
const { getRedisClient, closeRedisClient, isRedisUnavailableError } = require('../_lib/redis');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let redis;
  try {
    const body = req.body || {};
    const tokenInput = typeof body.resetToken === 'string'
      ? body.resetToken.trim()
      : (typeof body.securityAnswer === 'string' ? body.securityAnswer.trim() : '');
    const newPassword = body.newPassword;

    if (!tokenInput || typeof newPassword !== 'string' || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    redis = await getRedisClient();

    const ip = getClientIp(req);
    const rate = await checkRateLimit(redis, `ratelimit:reset:${ip}`, 5, 900);
    if (!rate.allowed) {
      await closeRedisClient(redis);
      return res.status(429).json({ error: 'Too many reset attempts. Please try again later.' });
    }

    const envToken = process.env.ADMIN_RESET_TOKEN;
    const storedTokenHash = await redis.get('security:reset_token_hash');

    if (!envToken && !storedTokenHash) {
      await closeRedisClient(redis);
      return res.status(503).json({ error: 'Password reset is not configured' });
    }

    let tokenValid = false;
    if (envToken && timingSafeCompare(tokenInput, envToken)) {
      tokenValid = true;
    } else if (storedTokenHash && bcrypt.compareSync(tokenInput, storedTokenHash)) {
      tokenValid = true;
    }

    if (!tokenValid) {
      await closeRedisClient(redis);
      return res.status(401).json({ error: 'Invalid reset token' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const userData = await redis.get('user:admin');

    if (userData) {
      const user = JSON.parse(userData);
      user.password = hashedPassword;
      user.updatedAt = new Date().toISOString();
      user.passwordSetByUser = true;
      await redis.set('user:admin', JSON.stringify(user));
    } else {
      await redis.set('user:admin', JSON.stringify({
        id: 'admin',
        username: 'admin',
        password: hashedPassword,
        passwordSetByUser: true,
        createdAt: new Date().toISOString()
      }));
    }

    await closeRedisClient(redis);
    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
