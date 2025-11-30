// Vercel Serverless Function - Change Password
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ezrefill-secret-key-change-in-production';

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

function verifyToken(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return null;
  
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
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

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let redis;
  try {
    const { currentPassword, newPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    redis = await getRedisClient();

    // Get user from Redis
    const userData = await redis.get(`user:${user.username}`);
    
    if (!userData) {
      // User doesn't exist in Redis yet (first time after default login)
      // Verify current password is the default
      if (currentPassword !== 'admin123') {
        await redis.disconnect();
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    } else {
      const existingUser = JSON.parse(userData);
      if (!bcrypt.compareSync(currentPassword, existingUser.password)) {
        await redis.disconnect();
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    // Hash new password and save
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await redis.set(`user:${user.username}`, JSON.stringify({
      id: user.id,
      username: user.username,
      password: hashedPassword,
      updatedAt: new Date().toISOString()
    }));

    await redis.disconnect();
    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    if (redis) await redis.disconnect().catch(() => {});
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
