// Single Vercel Serverless Function Router (1 of 12 Hobby limit)
import activationById from './_handlers/activation-by-id.js';
import adminActivations from './_handlers/admin-activations.js';
import adminActivationById from './_handlers/admin-activation-by-id.js';
import adminHistory from './_handlers/admin-history.js';
import adminHistoryById from './_handlers/admin-history-by-id.js';
import adminStatus from './_handlers/admin-status.js';
import adminCleanup from './_handlers/admin-cleanup.js';
import authLogin from './_handlers/auth-login.js';
import authLogout from './_handlers/auth-logout.js';
import authVerify from './_handlers/auth-verify.js';
import authChangePassword from './_handlers/auth-change-password.js';
import authResetPassword from './_handlers/auth-reset-password.js';
import shortlink from './_handlers/shortlink.js';
import shortlinkById from './_handlers/shortlink-by-id.js';

function resolveSubPath(req) {
  const rawParam = req.query?.__path;
  if (Array.isArray(rawParam)) {
    return rawParam.join('/').replace(/^\/+|\/+$/g, '');
  }
  if (typeof rawParam === 'string' && rawParam.trim()) {
    return rawParam.trim().replace(/^\/+|\/+$/g, '');
  }
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  return parsedUrl.pathname
    .replace(/^\/api\/?/, '')
    .replace(/^index\/?/, '')
    .replace(/^\/+|\/+$/g, '');
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const EXACT_ROUTES = {
  'auth/login': authLogin,
  'auth/logout': authLogout,
  'auth/verify': authVerify,
  'auth/change-password': authChangePassword,
  'auth/reset-password': authResetPassword,
  'admin/activations': adminActivations,
  'admin/history': adminHistory,
  'admin/status': adminStatus,
  'admin/cleanup': adminCleanup,
  shortlink
};

const DYNAMIC_ROUTES = [
  { pattern: /^admin\/activations\/([^/]+)$/, handler: adminActivationById },
  { pattern: /^admin\/history\/([^/]+)$/, handler: adminHistoryById },
  { pattern: /^activation\/([^/]+)$/, handler: activationById },
  { pattern: /^shortlink\/([^/]+)$/, handler: shortlinkById }
];

export default async function handler(req, res) {
  req.query = req.query || {};

  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // Leave non-JSON body intact
    }
  }

  const subPath = resolveSubPath(req);
  const exactHandler = EXACT_ROUTES[subPath];
  if (exactHandler) {
    return exactHandler(req, res);
  }

  for (const route of DYNAMIC_ROUTES) {
    const match = subPath.match(route.pattern);
    if (match) {
      const decodedId = safeDecode(match[1]);
      if (decodedId === null) {
        return res.status(400).json({ error: 'Malformed path parameter' });
      }
      req.query.id = decodedId;
      return route.handler(req, res);
    }
  }

  return res.status(404).json({ error: 'API route not found' });
}
