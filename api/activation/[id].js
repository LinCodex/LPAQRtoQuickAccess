// Vercel Serverless Function - Get activation status (public)
const { applyCors, validateId, validateLpaCode } = require('../_lib/auth');
const { getRedisClient, closeRedisClient, isRedisUnavailableError } = require('../_lib/redis');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid activation ID' });
  }

  let redis;

  try {
    redis = await getRedisClient();
    const activationData = await redis.get(`activation:${id}`);
    await closeRedisClient(redis);
    redis = null;

    if (!activationData) {
      return res.status(404).json({ error: 'Activation not found' });
    }

    const activation = JSON.parse(activationData);

    const maskedPhone = activation.phoneNumber
      ? activation.phoneNumber.slice(0, -4).replace(/./g, '*') + activation.phoneNumber.slice(-4)
      : null;

    let activationUrl = null;
    if (activation.status === 'active' && activation.lpaCode && validateLpaCode(activation.lpaCode)) {
      activationUrl = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(activation.lpaCode.trim())}`;
    }

    res.setHeader('Cache-Control', 'no-store');
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
    await closeRedisClient(redis);
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
