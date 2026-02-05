// Vercel Serverless Function - Create short link
const { createClient } = require('redis');

// Generate short 6-character ID (base62)
function generateShortId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function getRedisClient() {
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    return client;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { lpaCode } = req.body;

    if (!lpaCode || !lpaCode.startsWith('LPA:')) {
        return res.status(400).json({ error: 'Invalid LPA code' });
    }

    let redis;

    try {
        redis = await getRedisClient();

        // Generate unique short ID
        let shortId = generateShortId();
        let attempts = 0;

        // Ensure uniqueness
        while (await redis.exists(`shortlink:${shortId}`) && attempts < 10) {
            shortId = generateShortId();
            attempts++;
        }

        // Store the short link (expires in 30 days)
        await redis.set(`shortlink:${shortId}`, lpaCode, { EX: 60 * 60 * 24 * 30 });

        await redis.disconnect();

        const domain = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'https://ezrefillny.net';

        return res.status(201).json({
            shortId,
            shortUrl: `${domain}/s/${shortId}`,
            lpaCode
        });
    } catch (error) {
        console.error('Error creating short link:', error);
        if (redis) await redis.disconnect().catch(() => { });
        return res.status(500).json({ error: 'Internal server error' });
    }
};
