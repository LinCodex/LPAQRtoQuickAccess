// Handler - Login
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  getJwtSecret,
  applyCors,
  setSessionCookie,
  getClientIp,
  checkRateLimit,
  timingSafeCompare
} from '../_lib/auth.js';
import {
  getRedisConfig,
  getRedisClient,
  closeRedisClient,
  isRedisUnavailableError
} from '../_lib/redis.js';

export default async function handler(req, res) {
  applyCors(req, res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let redis;
  try {
    const { username, password, rememberMe } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const cleanUsername = username.trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(cleanUsername)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const remember = Boolean(rememberMe);
    const expiresIn = remember ? '30d' : '24h';
    const maxAgeSec = remember ? 30 * 24 * 60 * 60 : 86400;

    const jwtSecret = getJwtSecret();
    redis = await getRedisClient();

    const ip = getClientIp(req);
    const rate = await checkRateLimit(redis, `ratelimit:login:${ip}`, 10, 900);
    if (!rate.allowed) {
      await closeRedisClient(redis);
      return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    const userData = await redis.get(`user:${cleanUsername}`);
    const bootstrapPassword =
      typeof process.env.ADMIN_BOOTSTRAP_PASSWORD === 'string' && process.env.ADMIN_BOOTSTRAP_PASSWORD.length >= 8
        ? process.env.ADMIN_BOOTSTRAP_PASSWORD
        : null;

    if (!userData) {
      if (cleanUsername === 'admin' && bootstrapPassword && timingSafeCompare(password, bootstrapPassword)) {
        const hashedPassword = await bcrypt.hash(bootstrapPassword, 10);
        await redis.set('user:admin', JSON.stringify({
          id: 'admin',
          username: 'admin',
          password: hashedPassword,
          passwordSetByUser: false,
          createdAt: new Date().toISOString()
        }));

        const token = jwt.sign({ id: 'admin', username: 'admin' }, jwtSecret, { expiresIn });
        setSessionCookie(req, res, token, maxAgeSec);
        await closeRedisClient(redis);
        return res.status(200).json({ token, username: 'admin', isDefaultPassword: true, rememberMe: remember });
      }
      await closeRedisClient(redis);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = JSON.parse(userData);
    let passwordMatch = await bcrypt.compare(password, user.password);

    if (
      !passwordMatch &&
      cleanUsername === 'admin' &&
      !user.passwordSetByUser &&
      bootstrapPassword &&
      timingSafeCompare(password, bootstrapPassword)
    ) {
      const hashedPassword = await bcrypt.hash(bootstrapPassword, 10);
      await redis.set('user:admin', JSON.stringify({
        ...user,
        password: hashedPassword,
        passwordSetByUser: false,
        updatedAt: new Date().toISOString()
      }));
      passwordMatch = true;
    }

    if (!passwordMatch) {
      await closeRedisClient(redis);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, jwtSecret, { expiresIn });
    const isDefaultPassword = !user.passwordSetByUser;
    setSessionCookie(req, res, token, maxAgeSec);
    await closeRedisClient(redis);
    return res.status(200).json({ token, username: user.username, isDefaultPassword, rememberMe: remember });
  } catch (error) {
    console.error('Login error:', error);
    await closeRedisClient(redis);
    const { url } = getRedisConfig();
    if (!process.env.JWT_SECRET || !url) {
      return res.status(503).json({ error: 'Admin authentication is not configured on this server.' });
    }
    if (isRedisUnavailableError(error)) {
      return res.status(503).json({ error: 'Database service unavailable. Please check Redis storage configuration.' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
