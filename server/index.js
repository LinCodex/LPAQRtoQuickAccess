const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const COOKIE_NAME = 'ezrefill_session';
const ALLOWED_STATUSES = ['standby', 'processing', 'active'];

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const ACTIVATIONS_FILE = path.join(DATA_DIR, 'activations.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SHORTLINKS_FILE = path.join(DATA_DIR, 'shortlinks.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const JWT_SECRET_FILE = path.join(DATA_DIR, '.jwt-secret');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(ACTIVATIONS_FILE)) {
  fs.writeFileSync(ACTIVATIONS_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(SHORTLINKS_FILE)) {
  fs.writeFileSync(SHORTLINKS_FILE, JSON.stringify({}, null, 2));
}
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
}

function resolveLocalJwtSecret() {
  const envSecret = process.env.JWT_SECRET;
  if (typeof envSecret === 'string' && envSecret.trim().length >= 16) {
    return envSecret.trim();
  }
  try {
    if (fs.existsSync(JWT_SECRET_FILE)) {
      const saved = fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
  } catch {
    // Fall through to generate a persistent local secret
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(JWT_SECRET_FILE, generated, { mode: 0o600 });
  } catch (err) {
    console.warn('[server] Unable to persist local JWT secret; using in-memory secret:', err.message);
  }
  return generated;
}

const JWT_SECRET = resolveLocalJwtSecret();

const allowedOrigins = new Set([
  'https://ezrefillny.net',
  'https://www.ezrefillny.net',
  'https://lpaquicklink.vercel.app',
  ...(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
]);
if (process.env.PUBLIC_BASE_URL) {
  allowedOrigins.add(process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, ''));
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    try {
      const parsed = new URL(origin);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return callback(null, true);
      }
    } catch {
      return callback(null, false);
    }
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json());
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const localRateLimitMap = new Map();

function checkLocalRateLimit(bucketKey, maxAttempts, windowMs) {
  const now = Date.now();
  const entry = localRateLimitMap.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    localRateLimitMap.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= maxAttempts;
}

function getLocalClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function getBootstrapPassword() {
  const configured = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (typeof configured === 'string' && configured.length >= 8) {
    return configured;
  }
  return null;
}

function ensureBootstrapAdmin() {
  let users = [];
  if (fs.existsSync(USERS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(parsed)) users = parsed;
    } catch {
      users = [];
    }
  }
  const bootstrapPassword = getBootstrapPassword();
  if (!users.some((u) => u && u.username === 'admin') && bootstrapPassword) {
    const defaultAdmin = {
      id: uuidv4(),
      username: 'admin',
      password: bcrypt.hashSync(bootstrapPassword, 10),
      passwordSetByUser: false,
      createdAt: new Date().toISOString()
    };
    users.push(defaultAdmin);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } else if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
  return users;
}

ensureBootstrapAdmin();

const readActivations = () => {
  try {
    return JSON.parse(fs.readFileSync(ACTIVATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
};

const writeActivations = (data) => {
  fs.writeFileSync(ACTIVATIONS_FILE, JSON.stringify(data, null, 2));
};

const readUsers = () => {
  return ensureBootstrapAdmin();
};

const writeUsers = (data) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
};

const readShortLinks = () => {
  try {
    return JSON.parse(fs.readFileSync(SHORTLINKS_FILE, 'utf8'));
  } catch {
    return {};
  }
};

const writeShortLinks = (data) => {
  fs.writeFileSync(SHORTLINKS_FILE, JSON.stringify(data, null, 2));
};

const readHistory = () => {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeHistory = (data) => {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
};

function parseLpaParts(code) {
  const match = String(code || '').trim().match(/^(?:LPA:)?1\$([^$\s<>"]+)\$([^$\s<>"]+)(?:\$([^$\s<>"]*?))?(?:\$.*)?$/i);
  if (!match) return null;
  return {
    smdpAddress: match[1].trim(),
    activationCode: match[2].trim(),
    confirmationCode: (match[3] || '').trim()
  };
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] || null;
}

function setSessionCookie(res, token, maxAgeSec = 86400) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function validateId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(id);
}

function validateLpaCode(code) {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 512) return false;
  return /^LPA:1\$[^$\s<>"]+\$[^$\s<>"]+(?:\$[^$\s<>"]*)?$/i.test(trimmed);
}

function sanitizeField(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

const authenticateToken = (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ============ PUBLIC ROUTES ============

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/activation/:id', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { id } = req.params;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid activation ID' });
  }

  const activations = readActivations();
  const activation = activations.find((a) => a.id === id);

  if (!activation) {
    return res.status(404).json({ error: 'Activation not found' });
  }

  res.json({
    id: activation.id,
    status: activation.status,
    phoneNumber: activation.phoneNumber ? maskPhoneNumber(activation.phoneNumber) : null,
    lpaCode: activation.status === 'active' ? activation.lpaCode : null,
    activationUrl: activation.status === 'active' ? generateActivationUrl(activation.lpaCode) : null,
    createdAt: activation.createdAt,
    updatedAt: activation.updatedAt
  });
});

// ============ AUTH ROUTES ============

app.post('/api/auth/login', async (req, res) => {
  const ip = getLocalClientIp(req);
  if (!checkLocalRateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  const { username, password, rememberMe } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const cleanUsername = username.trim();
  const users = readUsers();
  const userIndex = users.findIndex((u) => u.username === cleanUsername);
  const user = userIndex >= 0 ? users[userIndex] : null;
  const bootstrapPassword = getBootstrapPassword();

  let authenticated = Boolean(user && (await bcrypt.compare(password, user.password)));

  if (
    !authenticated &&
    user &&
    cleanUsername === 'admin' &&
    !user.passwordSetByUser &&
    bootstrapPassword &&
    timingSafeCompare(password, bootstrapPassword)
  ) {
    users[userIndex].password = await bcrypt.hash(bootstrapPassword, 10);
    users[userIndex].updatedAt = new Date().toISOString();
    writeUsers(users);
    authenticated = true;
  }

  if (!user || !authenticated) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const remember = Boolean(rememberMe);
  const expiresIn = remember ? '30d' : '24h';
  const maxAgeSec = remember ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn });
  setSessionCookie(res, token, maxAgeSec);
  res.json({
    token,
    username: user.username,
    isDefaultPassword: !user.passwordSetByUser,
    rememberMe: remember
  });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.setHeader('Clear-Site-Data', '"cookies"');
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/verify', authenticateToken, (req, res) => {
  res.json({ valid: true, username: req.user.username });
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const users = readUsers();
  const userIndex = users.findIndex((u) => u.id === req.user.id || u.username === req.user.username);

  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (!(await bcrypt.compare(currentPassword, users[userIndex].password))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  users[userIndex].password = await bcrypt.hash(newPassword, 10);
  users[userIndex].passwordSetByUser = true;
  users[userIndex].updatedAt = new Date().toISOString();
  writeUsers(users);
  res.json({ message: 'Password changed successfully' });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const ip = getLocalClientIp(req);
  if (!checkLocalRateLimit(`reset:${ip}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many reset attempts. Please try again later.' });
  }

  const body = req.body || {};
  const tokenInput = typeof body.resetToken === 'string'
    ? body.resetToken.trim()
    : (typeof body.securityAnswer === 'string' ? body.securityAnswer.trim() : '');
  const newPassword = body.newPassword;

  const configuredToken = process.env.ADMIN_RESET_TOKEN;
  if (!configuredToken) {
    return res.status(503).json({ error: 'Password reset is not configured' });
  }
  if (!tokenInput || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'Valid reset token and 8+ character password required' });
  }

  if (!timingSafeCompare(tokenInput, configuredToken)) {
    return res.status(401).json({ error: 'Invalid reset token' });
  }

  const users = readUsers();
  const adminIdx = users.findIndex((u) => u.username === 'admin');
  const hashed = await bcrypt.hash(newPassword, 10);
  if (adminIdx >= 0) {
    users[adminIdx].password = hashed;
    users[adminIdx].passwordSetByUser = true;
    users[adminIdx].updatedAt = new Date().toISOString();
  } else {
    users.push({
      id: 'admin',
      username: 'admin',
      password: hashed,
      passwordSetByUser: true,
      createdAt: new Date().toISOString()
    });
  }
  writeUsers(users);
  res.json({ message: 'Password reset successfully' });
});

// ============ ADMIN ROUTES (Protected) ============

app.get('/api/admin/activations', authenticateToken, (req, res) => {
  const activations = readActivations();
  activations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(activations);
});

app.post('/api/admin/activations', authenticateToken, (req, res) => {
  const body = req.body || {};
  const phoneNumber = sanitizeField(body.phoneNumber || '', 32);
  const notes = sanitizeField(body.notes || '', 500);
  const rawLpa = typeof body.lpaCode === 'string' ? body.lpaCode.trim() : '';
  const requestedStatus =
    typeof body.status === 'string' && body.status ? body.status : (rawLpa ? 'active' : 'standby');

  if (rawLpa && !validateLpaCode(rawLpa)) {
    return res.status(400).json({ error: 'Invalid LPA code format' });
  }
  if (!ALLOWED_STATUSES.includes(requestedStatus)) {
    return res.status(400).json({ error: 'Invalid activation status' });
  }

  const activations = readActivations();
  const now = new Date().toISOString();
  const newActivation = {
    id: uuidv4().split('-')[0],
    phoneNumber,
    notes,
    status: requestedStatus,
    lpaCode: rawLpa,
    createdAt: now,
    updatedAt: now,
    createdBy: req.user.username
  };

  activations.push(newActivation);
  writeActivations(activations);
  res.status(201).json(newActivation);
});

app.put('/api/admin/activations/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid activation ID' });
  }

  const { phoneNumber, notes, status, lpaCode } = req.body || {};
  if (lpaCode !== undefined && typeof lpaCode === 'string' && lpaCode.trim() && !validateLpaCode(lpaCode)) {
    return res.status(400).json({ error: 'Invalid LPA code format' });
  }
  if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid activation status' });
  }

  const activations = readActivations();
  const index = activations.findIndex((a) => a.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Activation not found' });
  }

  if (phoneNumber !== undefined) activations[index].phoneNumber = sanitizeField(String(phoneNumber), 32);
  if (notes !== undefined) activations[index].notes = sanitizeField(String(notes), 500);
  if (lpaCode !== undefined) activations[index].lpaCode = typeof lpaCode === 'string' ? lpaCode.trim() : '';
  if (status !== undefined) activations[index].status = status;

  activations[index].updatedAt = new Date().toISOString();
  activations[index].updatedBy = req.user.username;

  writeActivations(activations);
  res.json(activations[index]);
});

app.delete('/api/admin/activations/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid activation ID' });
  }

  const activations = readActivations();
  const index = activations.findIndex((a) => a.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Activation not found' });
  }

  activations.splice(index, 1);
  writeActivations(activations);
  res.json({ message: 'Activation deleted' });
});

app.get('/api/admin/history', authenticateToken, (_req, res) => {
  const items = readHistory();
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(items);
});

app.post('/api/admin/history', authenticateToken, (req, res) => {
  const body = req.body || {};
  const rawLpa = typeof body.lpaCode === 'string' ? body.lpaCode.trim() : '';
  const phoneNumber = sanitizeField(body.phoneNumber || '', 32);

  if (!rawLpa || !validateLpaCode(rawLpa)) {
    return res.status(400).json({ error: 'Valid LPA code is required' });
  }

  const parts = parseLpaParts(rawLpa);
  if (!parts) {
    return res.status(400).json({ error: 'Invalid LPA code format' });
  }

  const items = readHistory();
  const matchIdx = items.findIndex((item) => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.smdpAddress === 'string' && typeof item.activationCode === 'string') {
      return (
        item.smdpAddress.trim().toLowerCase() === parts.smdpAddress.toLowerCase() &&
        item.activationCode.trim() === parts.activationCode &&
        String(item.confirmationCode || '').trim() === String(parts.confirmationCode || '').trim()
      );
    }
    return typeof item.lpaCode === 'string' && item.lpaCode.trim() === rawLpa;
  });

  if (matchIdx !== -1) {
    const existing = items[matchIdx];
    const updated = {
      ...existing,
      lpaCode: rawLpa,
      smdpAddress: parts.smdpAddress,
      activationCode: parts.activationCode,
      confirmationCode: parts.confirmationCode,
      phoneNumber: phoneNumber || existing.phoneNumber || '',
      activated: Boolean(existing.activated),
      activatedAt: existing.activated ? (existing.activatedAt || null) : null,
      updatedAt: new Date().toISOString()
    };
    items[matchIdx] = updated;
    const deduped = items.filter((item, idx) => {
      if (idx === matchIdx) return true;
      if (!item || typeof item !== 'object') return false;
      if (typeof item.smdpAddress === 'string' && typeof item.activationCode === 'string') {
        return !(
          item.smdpAddress.trim().toLowerCase() === parts.smdpAddress.toLowerCase() &&
          item.activationCode.trim() === parts.activationCode &&
          String(item.confirmationCode || '').trim() === String(parts.confirmationCode || '').trim()
        );
      }
      return !(typeof item.lpaCode === 'string' && item.lpaCode.trim() === rawLpa);
    });
    writeHistory(deduped);
    return res.status(200).json(updated);
  }

  const entry = {
    id: uuidv4().split('-')[0],
    lpaCode: rawLpa,
    smdpAddress: parts.smdpAddress,
    activationCode: parts.activationCode,
    confirmationCode: parts.confirmationCode,
    phoneNumber,
    activated: false,
    activatedAt: null,
    createdAt: new Date().toISOString(),
    createdBy: req.user.username
  };

  items.unshift(entry);
  if (items.length > 500) items.length = 500;
  writeHistory(items);
  res.status(201).json(entry);
});

function handleUpdateHistoryById(req, res) {
  const { id } = req.params;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid history ID' });
  }

  const items = readHistory();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'History entry not found' });
  }

  const existing = items[index];
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const nextActivated = typeof body.activated === 'boolean' ? body.activated : !Boolean(existing.activated);
  const nowIso = new Date().toISOString();
  const updated = {
    ...existing,
    activated: nextActivated,
    activatedAt: nextActivated ? (existing.activated && existing.activatedAt ? existing.activatedAt : nowIso) : null,
    updatedAt: nowIso,
    updatedBy: req.user.username
  };

  items[index] = updated;
  writeHistory(items);
  return res.json(updated);
}

app.patch('/api/admin/history/:id', authenticateToken, handleUpdateHistoryById);
app.put('/api/admin/history/:id', authenticateToken, handleUpdateHistoryById);

app.delete('/api/admin/history/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid history ID' });
  }

  const items = readHistory();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'History entry not found' });
  }

  items.splice(index, 1);
  writeHistory(items);
  res.json({ message: 'History entry deleted' });
});

app.delete('/api/admin/history', authenticateToken, (_req, res) => {
  writeHistory([]);
  res.json({ message: 'History cleared' });
});

function getFileBytesSafe(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

let lastLocalCleanupRun = null;

app.get('/api/admin/status', authenticateToken, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const startMs = Date.now();
  const HISTORY_LIMIT = 500;
  const SOFT_CAP_BYTES = 30 * 1024 * 1024;

  const activationsList = readActivations();
  const historyList = readHistory();
  const shortLinksObj = readShortLinks();
  const usersList = readUsers();

  const activationsBytes = getFileBytesSafe(ACTIVATIONS_FILE);
  const historyBytes = getFileBytesSafe(HISTORY_FILE);
  const shortlinksBytes = getFileBytesSafe(SHORTLINKS_FILE);
  const usersBytes = getFileBytesSafe(USERS_FILE);
  const usedBytes = activationsBytes + historyBytes + shortlinksBytes + usersBytes;
  const latencyMs = Math.max(1, Date.now() - startMs);

  const activationCounts = {
    total: Array.isArray(activationsList) ? activationsList.length : 0,
    standby: 0,
    processing: 0,
    active: 0,
    bytes: activationsBytes
  };
  if (Array.isArray(activationsList)) {
    for (const item of activationsList) {
      if (!item) continue;
      if (item.status === 'standby') activationCounts.standby += 1;
      else if (item.status === 'processing') activationCounts.processing += 1;
      else if (item.status === 'active') activationCounts.active += 1;
    }
  }

  const adminUser = Array.isArray(usersList)
    ? usersList.find((u) => u && u.username === 'admin')
    : null;
  const usingDefaultPassword = Boolean(adminUser && !adminUser.passwordSetByUser);

  const envJwtConfigured =
    typeof process.env.JWT_SECRET === 'string' && process.env.JWT_SECRET.trim().length >= 16;
  const localJwtConfigured = envJwtConfigured || fs.existsSync(JWT_SECRET_FILE);
  const redisConfigured = Boolean(
    (typeof process.env.REDIS_URL === 'string' && process.env.REDIS_URL.trim()) ||
    (typeof process.env.KV_URL === 'string' && process.env.KV_URL.trim())
  );
  const resetTokenConfigured =
    typeof process.env.ADMIN_RESET_TOKEN === 'string' && process.env.ADMIN_RESET_TOKEN.trim().length > 0;
  const bootstrapConfigured = Boolean(getBootstrapPassword());
  const publicBaseConfigured =
    typeof process.env.PUBLIC_BASE_URL === 'string' && process.env.PUBLIC_BASE_URL.trim().length > 0;

  const shortlinkKeys = shortLinksObj && typeof shortLinksObj === 'object' ? Object.keys(shortLinksObj) : [];
  const records = {
    activations: activationCounts,
    history: {
      total: Array.isArray(historyList) ? historyList.length : 0,
      limit: HISTORY_LIMIT,
      bytes: historyBytes
    },
    shortlinks: {
      total: shortlinkKeys.length,
      bytes: shortlinksBytes,
      ttlDays: 30
    },
    users: {
      total: Array.isArray(usersList) ? usersList.length : 0,
      hasAdmin: Boolean(adminUser),
      usingDefaultPassword
    }
  };

  const usagePercent = Number(((usedBytes / SOFT_CAP_BYTES) * 100).toFixed(2));
  const historyPercent = Number(((records.history.total / HISTORY_LIMIT) * 100).toFixed(2));

  let storageStatus = 'healthy';
  if (usagePercent >= 90) storageStatus = 'critical';
  else if (usagePercent >= 70) storageStatus = 'warning';

  let historyStatus = 'healthy';
  if (records.history.total >= 475) historyStatus = 'critical';
  else if (records.history.total >= 400) historyStatus = 'warning';

  let authStatus = 'healthy';
  let authDetail = 'JWT signing & admin credentials active';
  if (!localJwtConfigured) {
    authStatus = 'critical';
    authDetail = 'JWT secret unavailable';
  } else if (usingDefaultPassword) {
    authStatus = 'warning';
    authDetail = 'Admin account is still using bootstrap password';
  } else if (!resetTokenConfigured) {
    authStatus = 'warning';
    authDetail = 'ADMIN_RESET_TOKEN not set in local env';
  }

  const limits = [
    {
      id: 'database',
      label: 'Database Connection',
      status: 'healthy',
      detail: `Local JSON store ready (${latencyMs} ms read)`,
      used: latencyMs,
      limit: 400,
      unit: 'ms',
      percent: null
    },
    {
      id: 'storage',
      label: 'Storage Usage',
      status: storageStatus,
      detail: `${usagePercent}% of 30 MiB soft cap`,
      used: usedBytes,
      limit: SOFT_CAP_BYTES,
      unit: 'bytes',
      percent: usagePercent
    },
    {
      id: 'history',
      label: 'Generated History Cap',
      status: historyStatus,
      detail: `${records.history.total} / ${HISTORY_LIMIT} entries stored`,
      used: records.history.total,
      limit: HISTORY_LIMIT,
      unit: 'records',
      percent: historyPercent
    },
    {
      id: 'auth',
      label: 'Admin Security & Auth',
      status: authStatus,
      detail: authDetail,
      used: null,
      limit: null,
      unit: null,
      percent: null
    }
  ];

  const overall = limits.some((l) => l.status === 'critical')
    ? 'critical'
    : limits.some((l) => l.status === 'warning')
      ? 'warning'
      : 'healthy';

  res.json({
    overall,
    checkedAt: new Date().toISOString(),
    runtime: {
      platform: 'local',
      environment: process.env.NODE_ENV || 'development',
      region: 'local',
      nodeVersion: process.version,
      publicBaseUrl: publicBaseConfigured
        ? process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, '')
        : `${req.protocol}://${req.get('host')}`,
      commitSha: null
    },
    database: {
      type: 'local-json',
      provider: 'Local JSON Files',
      status: 'connected',
      latencyMs,
      usedBytes,
      limitBytes: SOFT_CAP_BYTES,
      limitSource: 'soft-cap',
      usagePercent,
      totalKeys:
        records.activations.total +
        records.history.total +
        records.shortlinks.total +
        records.users.total,
      evictionPolicy: null,
      errorMessage: null
    },
    records,
    env: [
      {
        key: 'REDIS_URL',
        required: false,
        configured: redisConfigured,
        note: 'Not required locally (uses JSON files); required on Vercel'
      },
      {
        key: 'JWT_SECRET',
        required: true,
        configured: localJwtConfigured,
        note: envJwtConfigured
          ? 'Session signing secret (16+ chars via JWT_SECRET env var)'
          : 'Local persistent secret (.jwt-secret file or JWT_SECRET env var)'
      },
      {
        key: 'ADMIN_RESET_TOKEN',
        required: false,
        configured: resetTokenConfigured,
        note: 'Token for admin password recovery'
      },
      {
        key: 'ADMIN_BOOTSTRAP_PASSWORD',
        required: false,
        configured: bootstrapConfigured,
        note: 'Initial admin setup password (optional once custom password is set)'
      },
      {
        key: 'PUBLIC_BASE_URL',
        required: false,
        configured: publicBaseConfigured,
        note: 'Canonical public URL (defaults to request host / ezrefillny.net)'
      }
    ],
    limits,
    autoCleanup: {
      enabled: true,
      thresholdPercent: 80,
      targetPercent: 65,
      lastRun: lastLocalCleanupRun
    }
  });
});

app.post('/api/admin/cleanup', authenticateToken, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const HISTORY_LIMIT = 500;
  const SOFT_CAP_BYTES = 30 * 1024 * 1024;
  const SHORTLINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  const beforeBytes =
    getFileBytesSafe(ACTIVATIONS_FILE) +
    getFileBytesSafe(HISTORY_FILE) +
    getFileBytesSafe(SHORTLINKS_FILE) +
    getFileBytesSafe(USERS_FILE);
  const usageBeforePercent = Number(((beforeBytes / SOFT_CAP_BYTES) * 100).toFixed(2));

  let removedHistory = 0;
  const historyList = readHistory();
  if (Array.isArray(historyList) && historyList.length > HISTORY_LIMIT) {
    historyList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    removedHistory = historyList.length - HISTORY_LIMIT;
    writeHistory(historyList.slice(0, HISTORY_LIMIT));
  }

  let removedShortlinks = 0;
  const shortLinksObj = readShortLinks();
  if (shortLinksObj && typeof shortLinksObj === 'object') {
    const nowMs = Date.now();
    for (const [id, entry] of Object.entries(shortLinksObj)) {
      const createdMs = entry && entry.createdAt ? Date.parse(entry.createdAt) : NaN;
      if (Number.isFinite(createdMs) && nowMs - createdMs >= SHORTLINK_TTL_MS) {
        delete shortLinksObj[id];
        removedShortlinks += 1;
      }
    }
    if (removedShortlinks > 0) {
      writeShortLinks(shortLinksObj);
    }
  }

  const afterBytes =
    getFileBytesSafe(ACTIVATIONS_FILE) +
    getFileBytesSafe(HISTORY_FILE) +
    getFileBytesSafe(SHORTLINKS_FILE) +
    getFileBytesSafe(USERS_FILE);
  const usageAfterPercent = Number(((afterBytes / SOFT_CAP_BYTES) * 100).toFixed(2));
  const totalDeleted = removedHistory + removedShortlinks;
  const freedBytesEstimate = Math.max(0, beforeBytes - afterBytes);

  const report = {
    ranAt: new Date().toISOString(),
    reason: 'manual',
    thresholdPercent: 80,
    targetPercent: 65,
    usageBeforePercent,
    usageAfterPercent,
    deleted: {
      orphans: 0,
      ratelimits: 0,
      history: removedHistory,
      shortlinks: removedShortlinks,
      activations: 0
    },
    totalDeleted,
    freedBytesEstimate
  };

  lastLocalCleanupRun = report;
  res.json(report);
});

// ============ HELPER FUNCTIONS ============

function maskPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return trimmed.slice(0, -4).replace(/\d/g, '*') + trimmed.slice(-4);
}

function generateActivationUrl(lpaCode) {
  if (!validateLpaCode(lpaCode)) return null;
  return `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaCode.trim())}`;
}

const BASE62_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generateShortId() {
  const bytes = crypto.randomBytes(6);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += BASE62_ALPHABET.charAt(bytes[i] % BASE62_ALPHABET.length);
  }
  return result;
}

// ============ SHORT LINK ROUTES ============

app.post('/api/shortlink', (req, res) => {
  const ip = getLocalClientIp(req);
  if (!checkLocalRateLimit(`shortlink:${ip}`, 30, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many short link requests. Please try again shortly.' });
  }

  const { lpaCode } = req.body || {};

  if (!validateLpaCode(lpaCode)) {
    return res.status(400).json({ error: 'Invalid LPA code' });
  }

  try {
    const shortLinks = readShortLinks();
    let shortId = generateShortId();
    let attempts = 0;

    while (shortLinks[shortId] && attempts < 10) {
      shortId = generateShortId();
      attempts++;
    }

    const normalizedLpa = lpaCode.trim();
    shortLinks[shortId] = {
      lpaCode: normalizedLpa,
      createdAt: new Date().toISOString()
    };

    writeShortLinks(shortLinks);
    const domain = `${req.protocol}://${req.get('host')}`;

    return res.status(201).json({
      shortId,
      shortUrl: `${domain}/s/${shortId}`,
      lpaCode: normalizedLpa
    });
  } catch (error) {
    console.error('Error creating short link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/shortlink/:id', (req, res) => {
  const { id } = req.params;

  if (!validateId(id)) {
    return res.status(400).json({ error: 'Invalid short link ID' });
  }

  try {
    const shortLinks = readShortLinks();
    const linkData = shortLinks[id];

    if (!linkData || !validateLpaCode(linkData.lpaCode)) {
      return res.status(404).json({ error: 'Short link not found' });
    }

    const activationUrl = generateActivationUrl(linkData.lpaCode);

    return res.json({
      lpaCode: linkData.lpaCode,
      activationUrl
    });
  } catch (error) {
    console.error('Error fetching short link:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`EZRefill API Server running on port ${PORT}`);
});
