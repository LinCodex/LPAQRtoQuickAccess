// Vercel Serverless Function - Verify token
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ezrefill-secret-key-change-in-production';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({ valid: true, username: user.username });
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}
