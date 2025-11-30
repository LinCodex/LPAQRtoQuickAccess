// Vercel Serverless Function - List/Create activations
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let redis;

  // GET - List all activations (requires auth)
  if (req.method === 'GET') {
    const user = verifyToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      redis = await getRedisClient();
      
      // Get all activation IDs
      const activationIds = await redis.sMembers('activations');
      
      if (!activationIds || activationIds.length === 0) {
        await redis.disconnect();
        return res.status(200).json([]);
      }

      // Fetch all activations
      const activations = await Promise.all(
        activationIds.map(async (id) => {
          const data = await redis.get(`activation:${id}`);
          return data ? JSON.parse(data) : null;
        })
      );

      await redis.disconnect();

      // Filter out nulls and sort by createdAt descending
      const validActivations = activations
        .filter(a => a)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.status(200).json(validActivations);
    } catch (error) {
      console.error('Error listing activations:', error);
      if (redis) await redis.disconnect().catch(() => {});
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // POST - Create new activation (public for standby, auth for active)
  if (req.method === 'POST') {
    const user = verifyToken(req);
    const { phoneNumber, notes, lpaCode } = req.body || {};

    // If LPA code is provided, require auth
    if (lpaCode && !user) {
      return res.status(401).json({ error: 'Authentication required to set LPA code' });
    }

    try {
      redis = await getRedisClient();
      
      const id = uuidv4().split('-')[0];
      const { status } = req.body || {};
      const activation = {
        id,
        phoneNumber: phoneNumber || '',
        notes: notes || '',
        status: status || 'standby',
        lpaCode: lpaCode || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: user ? user.username : 'webapp'
      };

      // Save activation
      await redis.set(`activation:${id}`, JSON.stringify(activation));
      // Add to activations set
      await redis.sAdd('activations', id);

      await redis.disconnect();
      return res.status(201).json(activation);
    } catch (error) {
      console.error('Error creating activation:', error);
      if (redis) await redis.disconnect().catch(() => {});
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
