import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const HTTPS_COOKIE_NAME = '__Host-ezrefill_session';
const LOCAL_COOKIE_NAME = 'ezrefill_session';
const ALLOWED_STATUSES = ['standby', 'processing', 'active'];

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 16) {
    throw new Error('JWT_SECRET environment variable must be configured');
  }
  return secret.trim();
}

export function isHttpsRequest(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  if (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') {
    const host = String(req.headers.host || '');
    return !host.startsWith('localhost') && !host.startsWith('127.0.0.1');
  }
  return false;
}

export function isOriginAllowed(origin) {
  if (!origin || typeof origin !== 'string') return false;
  const configured = new Set();

  if (process.env.ALLOWED_ORIGINS) {
    for (const item of process.env.ALLOWED_ORIGINS.split(',')) {
      const trimmed = item.trim().replace(/\/+$/, '');
      if (trimmed) configured.add(trimmed);
    }
  }
  if (process.env.PUBLIC_BASE_URL) {
    configured.add(process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, ''));
  }
  if (process.env.VERCEL_URL) {
    configured.add(`https://${process.env.VERCEL_URL.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')}`);
  }
  configured.add('https://ezrefillny.net');
  configured.add('https://www.ezrefillny.net');
  configured.add('https://lpaquicklink.vercel.app');

  if (configured.has(origin)) return true;

  if (!process.env.VERCEL) {
    try {
      const parsed = new URL(origin);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function applyCors(req, res, methods) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header || typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[name] = decodeURIComponent(val);
    } catch {
      cookies[name] = val;
    }
  }
  return cookies;
}

export function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookies(req);
  return cookies[HTTPS_COOKIE_NAME] || cookies[LOCAL_COOKIE_NAME] || null;
}

export function setSessionCookie(req, res, token, maxAgeSec = 86400) {
  const secure = isHttpsRequest(req);
  const name = secure ? HTTPS_COOKIE_NAME : LOCAL_COOKIE_NAME;
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req, res) {
  const secure = isHttpsRequest(req);
  const cookies = [
    `${LOCAL_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${HTTPS_COOKIE_NAME}=; Path=/; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Max-Age=0`
  ];
  res.setHeader('Set-Cookie', cookies);
}

export function verifyToken(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export async function checkRateLimit(redis, bucketKey, maxAttempts, windowSec) {
  try {
    const count = await redis.incr(bucketKey);
    if (count === 1) {
      await redis.expire(bucketKey, windowSec);
    }
    return {
      allowed: count <= maxAttempts,
      remaining: Math.max(0, maxAttempts - count)
    };
  } catch {
    return { allowed: true, remaining: maxAttempts };
  }
}

export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function validateId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(id);
}

export function validateLpaCode(code) {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return false;
  return /^LPA:1\$[^$\s<>"]+\$[^$\s<>"]+(?:\$[^$\s<>"]*)?$/i.test(trimmed);
}

export function parseLpaParts(code) {
  const match = String(code || '').trim().match(/^(?:LPA:)?1\$([^$\s<>"]+)\$([^$\s<>"]+)(?:\$([^$\s<>"]*?))?(?:\$.*)?$/i);
  if (!match) return null;
  return {
    smdpAddress: match[1].trim(),
    activationCode: match[2].trim(),
    confirmationCode: (match[3] || '').trim()
  };
}

export function validateStatus(status) {
  return typeof status === 'string' && ALLOWED_STATUSES.includes(status);
}

export function sanitizeField(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (host) {
    const proto = String(req.headers['x-forwarded-proto'] || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')).split(',')[0].trim();
    return `${proto}://${host}`;
  }
  return 'https://ezrefillny.net';
}
