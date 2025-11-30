// Vercel Serverless Function - Reset Password with Security Question
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');

// Security question answer (stored here, but verified against Redis if set)
const DEFAULT_SECURITY_ANSWER = 'une20108';

async function getRedisClient() {
  const client = createClient({
    url: process.env.REDIS_URL
  });
  await client.connect();
  return client;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let redis;
  try {
    const { securityAnswer, newPassword } = req.body || {};

    if (!securityAnswer || !newPassword) {
      return res.status(400).json({ error: 'Security answer and new password required' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    redis = await getRedisClient();

    // Get security answer from Redis (or use default)
    const storedAnswer = await redis.get('security:answer');
    const correctAnswer = storedAnswer || DEFAULT_SECURITY_ANSWER;

    // Verify security answer (case-insensitive, trimmed)
    if (securityAnswer.toLowerCase().trim() !== correctAnswer.toLowerCase().trim()) {
      await redis.disconnect();
      return res.status(401).json({ error: 'Incorrect security answer' });
    }

    // Update admin password
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const userData = await redis.get('user:admin');
    
    if (userData) {
      const user = JSON.parse(userData);
      user.password = hashedPassword;
      user.updatedAt = new Date().toISOString();
      user.passwordSetByUser = true; // Mark that password was set by user
      await redis.set('user:admin', JSON.stringify(user));
    } else {
      // Create admin user with new password
      await redis.set('user:admin', JSON.stringify({
        id: 'admin',
        username: 'admin',
        password: hashedPassword,
        passwordSetByUser: true,
        createdAt: new Date().toISOString()
      }));
    }

    await redis.disconnect();
    return res.status(200).json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    if (redis) await redis.disconnect().catch(() => {});
    return res.status(500).json({ error: 'Internal server error' });
  }
};
