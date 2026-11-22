// Vercel Serverless Function - Logout
const { applyCors, clearSessionCookie } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  clearSessionCookie(req, res);
  res.setHeader('Clear-Site-Data', '"cookies", "storage"');
  return res.status(200).json({ message: 'Logged out' });
};
