// Vercel Serverless Function - List/Create activations
import { kv } from '@vercel/kv';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'ezrefill-secret-key-change-in-production';

function verifyToken(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return null;
  
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - List all activations (requires auth)
  if (req.method === 'GET') {
    const user = verifyToken(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      // Get all activation IDs
      const activationIds = await kv.smembers('activations');
      
      if (!activationIds || activationIds.length === 0) {
        return res.status(200).json([]);
      }

      // Fetch all activations
      const activations = await Promise.all(
        activationIds.map(id => kv.hgetall(`activation:${id}`))
      );

      // Filter out nulls and sort by createdAt descending
      const validActivations = activations
        .filter(a => a && Object.keys(a).length > 0)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      return res.status(200).json(validActivations);
    } catch (error) {
      console.error('Error listing activations:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // POST - Create new activation (public for standby, auth for active)
  if (req.method === 'POST') {
    const user = verifyToken(req);
    const { phoneNumber, notes, lpaCode } = req.body;

    // If LPA code is provided, require auth
    if (lpaCode && !user) {
      return res.status(401).json({ error: 'Authentication required to set LPA code' });
    }

    try {
      const id = uuidv4().split('-')[0];
      const activation = {
        id,
        phoneNumber: phoneNumber || '',
        notes: notes || '',
        status: lpaCode ? 'active' : 'standby',
        lpaCode: lpaCode || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: user ? user.username : 'webapp'
      };

      // Save activation
      await kv.hset(`activation:${id}`, activation);
      // Add to activations set
      await kv.sadd('activations', id);

      return res.status(201).json(activation);
    } catch (error) {
      console.error('Error creating activation:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
