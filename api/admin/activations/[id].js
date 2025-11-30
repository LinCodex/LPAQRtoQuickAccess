// Vercel Serverless Function - Update/Delete activation
import { kv } from '@vercel/kv';
import jwt from 'jsonwebtoken';

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
  res.setHeader('Access-Control-Allow-Methods', 'PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { id } = req.query;

  // PUT - Update activation
  if (req.method === 'PUT') {
    const { phoneNumber, notes, status, lpaCode } = req.body;

    try {
      const activation = await kv.hgetall(`activation:${id}`);
      
      if (!activation || Object.keys(activation).length === 0) {
        return res.status(404).json({ error: 'Activation not found' });
      }

      // Update fields
      const updatedActivation = {
        ...activation,
        phoneNumber: phoneNumber !== undefined ? phoneNumber : activation.phoneNumber,
        notes: notes !== undefined ? notes : activation.notes,
        lpaCode: lpaCode !== undefined ? lpaCode : activation.lpaCode,
        updatedAt: new Date().toISOString(),
        updatedBy: user.username
      };

      // Auto-set status based on LPA code
      if (lpaCode && lpaCode.trim()) {
        updatedActivation.status = 'active';
      } else if (status) {
        updatedActivation.status = status;
      }

      // If explicitly setting to standby, clear LPA code
      if (status === 'standby') {
        updatedActivation.lpaCode = '';
        updatedActivation.status = 'standby';
      }

      await kv.hset(`activation:${id}`, updatedActivation);

      return res.status(200).json(updatedActivation);
    } catch (error) {
      console.error('Error updating activation:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // DELETE - Delete activation
  if (req.method === 'DELETE') {
    try {
      const activation = await kv.hgetall(`activation:${id}`);
      
      if (!activation || Object.keys(activation).length === 0) {
        return res.status(404).json({ error: 'Activation not found' });
      }

      await kv.del(`activation:${id}`);
      await kv.srem('activations', id);

      return res.status(200).json({ message: 'Activation deleted' });
    } catch (error) {
      console.error('Error deleting activation:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
