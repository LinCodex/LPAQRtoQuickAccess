// Handler - Logout
import { applyCors, clearSessionCookie } from '../_lib/auth.js';

export default async function handler(req, res) {
  applyCors(req, res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  clearSessionCookie(req, res);
  res.setHeader('Clear-Site-Data', '"cookies"');
  return res.status(200).json({ message: 'Logged out' });
}
