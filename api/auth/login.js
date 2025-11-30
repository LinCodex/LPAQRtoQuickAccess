// Vercel Serverless Function - Login
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ezrefill-secret-key-change-in-production';

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
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    redis = await getRedisClient();

    // Get user from Redis
    const userData = await redis.get(`user:${username}`);
    
    if (!userData) {
      // First time setup - create admin user if credentials match default
      if (username === 'admin' && password === 'admin123') {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        await redis.set(`user:admin`, JSON.stringify({
          id: 'admin',
          username: 'admin',
          password: hashedPassword,
          createdAt: new Date().toISOString()
        }));
        
        const token = jwt.sign({ id: 'admin', username: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        await redis.disconnect();
        return res.status(200).json({ token, username: 'admin' });
      }
      await redis.disconnect();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = JSON.parse(userData);

    if (!bcrypt.compareSync(password, user.password)) {
      await redis.disconnect();
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    await redis.disconnect();
    return res.status(200).json({ token, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    if (redis) await redis.disconnect().catch(() => {});
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
