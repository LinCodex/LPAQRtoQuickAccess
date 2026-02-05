// Vercel Serverless Function - Get short link data
const { createClient } = require('redis');

async function getRedisClient() {
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    return client;
}

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

    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: 'Missing short link ID' });
    }

    let redis;

    try {
        redis = await getRedisClient();
        const lpaCode = await redis.get(`shortlink:${id}`);
        await redis.disconnect();

        if (!lpaCode) {
            return res.status(404).json({ error: 'Short link not found or expired' });
        }

        // Generate Apple eSIM activation URL
        const activationUrl = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaCode)}`;

        return res.status(200).json({
            lpaCode,
            activationUrl
        });
    } catch (error) {
        console.error('Error fetching short link:', error);
        if (redis) await redis.disconnect().catch(() => { });
        return res.status(500).json({ error: 'Internal server error' });
    }
};
