// Vercel Serverless Function - Login
import { kv } from '@vercel/kv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'ezrefill-secret-key-change-in-production';

export default async function handler(req, res) {
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

  const { username, password } = req.body;

  try {
    // Get user from KV
    const user = await kv.hgetall(`user:${username}`);
    
    if (!user || Object.keys(user).length === 0) {
      // Check for default admin (first time setup)
      if (username === 'admin' && password === 'admin123') {
        // Create default admin user
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        await kv.hset(`user:admin`, {
          id: 'admin',
          username: 'admin',
          password: hashedPassword,
          createdAt: new Date().toISOString()
        });
        
        const token = jwt.sign({ id: 'admin', username: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        return res.status(200).json({ token, username: 'admin' });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    return res.status(200).json({ token, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
