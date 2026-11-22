// Vercel Serverless Function - Verify token
const { applyCors, verifyToken } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return res.status(200).json({ valid: true, username: user.username });
};
