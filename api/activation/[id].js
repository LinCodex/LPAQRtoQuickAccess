// Vercel Serverless Function - Get activation status (public)
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Enable CORS
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

  const { id } = req.query;

  try {
    const activation = await kv.hgetall(`activation:${id}`);
    
    if (!activation || Object.keys(activation).length === 0) {
      return res.status(404).json({ error: 'Activation not found' });
    }

    // Mask phone number for public display
    const maskedPhone = activation.phoneNumber 
      ? activation.phoneNumber.slice(0, -4).replace(/./g, '*') + activation.phoneNumber.slice(-4)
      : null;

    // Generate activation URL if active
    let activationUrl = null;
    if (activation.status === 'active' && activation.lpaCode) {
      activationUrl = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(activation.lpaCode)}`;
    }

    return res.status(200).json({
      id: activation.id,
      status: activation.status,
      phoneNumber: maskedPhone,
      lpaCode: activation.status === 'active' ? activation.lpaCode : null,
      activationUrl,
      createdAt: activation.createdAt,
      updatedAt: activation.updatedAt
    });
  } catch (error) {
    console.error('Error fetching activation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
