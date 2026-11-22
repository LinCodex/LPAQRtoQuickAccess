// Vercel Serverless Function - Authenticated Backend Health, Storage & Limit Status
const { applyCors, verifyToken, getPublicBaseUrl } = require('../_lib/auth');
const {
  getRedisConfig,
  getRedisClient,
  closeRedisClient,
  isRedisUnavailableError
} = require('../_lib/redis');

const HISTORY_LIMIT = 500;
const SHORTLINK_TTL_DAYS = 30;
const SHORTLINK_SCAN_CAP = 2000;
const USER_SCAN_CAP = 100;
const BYTES_PER_MIB = 1024 * 1024;

function buildEnvStatus(redisConfig) {
  const jwtVal = typeof process.env.JWT_SECRET === 'string' ? process.env.JWT_SECRET.trim() : '';
  const resetVal = typeof process.env.ADMIN_RESET_TOKEN === 'string' ? process.env.ADMIN_RESET_TOKEN.trim() : '';
  const bootstrapVal = typeof process.env.ADMIN_BOOTSTRAP_PASSWORD === 'string' ? process.env.ADMIN_BOOTSTRAP_PASSWORD : '';
  const publicBaseVal = typeof process.env.PUBLIC_BASE_URL === 'string' ? process.env.PUBLIC_BASE_URL.trim() : '';

  return {
    jwtConfigured: jwtVal.length >= 16,
    resetTokenConfigured: resetVal.length > 0,
    list: [
      {
        key: 'REDIS_URL',
        required: true,
        configured: Boolean(redisConfig.url),
        note: 'Redis connection string (REDIS_URL or KV_URL)'
      },
      {
        key: 'JWT_SECRET',
        required: true,
        configured: jwtVal.length >= 16,
        note: 'Session signing secret (16+ chars)'
      },
      {
        key: 'ADMIN_RESET_TOKEN',
        required: false,
        configured: resetVal.length > 0,
        note: 'Token for admin password recovery'
      },
      {
        key: 'ADMIN_BOOTSTRAP_PASSWORD',
        required: false,
        configured: bootstrapVal.length >= 8,
        note: 'Initial admin setup password (optional once custom password is set)'
      },
      {
        key: 'PUBLIC_BASE_URL',
        required: false,
        configured: publicBaseVal.length > 0,
        note: 'Canonical public URL (defaults to request host / ezrefillny.net)'
      }
    ]
  };
}

function sanitizeDbError(err, hasUrl) {
  if (!hasUrl || (err && err.code === 'REDIS_NOT_CONFIGURED')) {
    return 'REDIS_URL environment variable is not configured';
  }
  if (!err) return 'Unable to connect to Redis';
  if (err.code) {
    return `Redis connection error (${String(err.code)})`;
  }
  const safeMsg = String(err.message || 'Unable to reach Redis database')
    .replace(/rediss?:\/\/\S+/gi, '[redacted]')
    .slice(0, 120);
  return safeMsg || 'Unable to reach Redis database';
}

function resolveLimitBytes(provider, maxMemoryParsed) {
  if (Number.isFinite(maxMemoryParsed) && maxMemoryParsed > 0) {
    return { limitBytes: maxMemoryParsed, limitSource: 'redis-maxmemory' };
  }
  const envMb = Number(process.env.REDIS_MAX_MEMORY_MB);
  if (Number.isFinite(envMb) && envMb > 0) {
    return { limitBytes: Math.round(envMb * BYTES_PER_MIB), limitSource: 'env-configured' };
  }
  if (provider === 'Upstash Redis') {
    return { limitBytes: 256 * BYTES_PER_MIB, limitSource: 'plan-default' };
  }
  return { limitBytes: 30 * BYTES_PER_MIB, limitSource: 'plan-default' };
}

function parseRedisInfoMemory(infoText) {
  if (typeof infoText !== 'string' || !infoText) {
    return { usedMemory: null, maxMemory: null, evictionPolicy: null };
  }
  const usedMatch = infoText.match(/^used_memory:(\d+)/m);
  const maxMatch = infoText.match(/^maxmemory:(\d+)/m);
  const policyMatch = infoText.match(/^maxmemory_policy:([^\r\n]+)/m);
  return {
    usedMemory: usedMatch ? Number(usedMatch[1]) : null,
    maxMemory: maxMatch ? Number(maxMatch[1]) : null,
    evictionPolicy: policyMatch ? policyMatch[1].trim() : null
  };
}

function buildLimitsAndOverall(database, records, envMeta) {
  const storagePercent =
    database.limitBytes && database.limitBytes > 0
      ? Number(((database.usedBytes / database.limitBytes) * 100).toFixed(2))
      : null;

  let storageStatus = 'healthy';
  if (database.status !== 'connected') {
    storageStatus = 'critical';
  } else if (storagePercent !== null && storagePercent >= 90) {
    storageStatus = 'critical';
  } else if (storagePercent !== null && storagePercent >= 70) {
    storageStatus = 'warning';
  }

  const historyPercent = Number(((records.history.total / HISTORY_LIMIT) * 100).toFixed(2));
  let historyStatus = 'healthy';
  if (records.history.total >= 475) {
    historyStatus = 'critical';
  } else if (records.history.total >= 400) {
    historyStatus = 'warning';
  }

  let dbStatus = 'healthy';
  if (database.status !== 'connected') {
    dbStatus = 'critical';
  } else if (typeof database.latencyMs === 'number' && database.latencyMs >= 400) {
    dbStatus = 'warning';
  }

  let authStatus = 'healthy';
  let authDetail = 'JWT signing & admin credentials active';
  if (!envMeta.jwtConfigured) {
    authStatus = 'critical';
    authDetail = 'JWT_SECRET is missing or too short';
  } else if (records.users.usingDefaultPassword && !envMeta.resetTokenConfigured) {
    authStatus = 'warning';
    authDetail = 'Using bootstrap password and ADMIN_RESET_TOKEN is not set';
  } else if (records.users.usingDefaultPassword) {
    authStatus = 'warning';
    authDetail = 'Admin account is still using bootstrap password';
  } else if (!envMeta.resetTokenConfigured) {
    authStatus = 'warning';
    authDetail = 'ADMIN_RESET_TOKEN is not configured for recovery';
  }

  const limits = [
    {
      id: 'database',
      label: 'Database Connection',
      status: dbStatus,
      detail:
        database.status === 'connected'
          ? `Connected (${database.latencyMs ?? 0} ms ping)`
          : database.errorMessage || 'Database unavailable',
      used: database.latencyMs,
      limit: 400,
      unit: 'ms',
      percent: null
    },
    {
      id: 'storage',
      label: 'Storage Usage',
      status: storageStatus,
      detail:
        database.status !== 'connected'
          ? 'Storage offline — connect or restore Redis'
          : `${storagePercent ?? 0}% of ${Math.round((database.limitBytes || 0) / BYTES_PER_MIB)} MiB limit`,
      used: database.usedBytes,
      limit: database.limitBytes,
      unit: 'bytes',
      percent: storagePercent
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

  const hasCritical =
    limits.some((item) => item.status === 'critical') ||
    database.status !== 'connected' ||
    envMeta.list.some((v) => v.required && !v.configured);
  const hasWarning = limits.some((item) => item.status === 'warning');

  const overall = hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy';
  return { overall, storagePercent, limits };
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const redisConfig = getRedisConfig();
  const envMeta = buildEnvStatus(redisConfig);
  const runtime = {
    platform: 'vercel',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    region: process.env.VERCEL_REGION || 'unknown',
    nodeVersion: process.version,
    publicBaseUrl: getPublicBaseUrl(req),
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA
      ? String(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 7)
      : null
  };

  const records = {
    activations: { total: 0, standby: 0, processing: 0, active: 0, bytes: 0 },
    history: { total: 0, limit: HISTORY_LIMIT, bytes: 0 },
    shortlinks: { total: 0, bytes: 0, ttlDays: SHORTLINK_TTL_DAYS },
    users: { total: 0, hasAdmin: false, usingDefaultPassword: false }
  };

  const limitDefaults = resolveLimitBytes(redisConfig.provider, null);
  const database = {
    type: 'redis',
    provider: redisConfig.provider,
    status: redisConfig.url ? 'error' : 'unconfigured',
    latencyMs: null,
    usedBytes: 0,
    limitBytes: limitDefaults.limitBytes,
    limitSource: limitDefaults.limitSource,
    usagePercent: null,
    totalKeys: null,
    evictionPolicy: null,
    errorMessage: null
  };

  let redis = null;

  try {
    const startMs = Date.now();
    redis = await getRedisClient({ timeoutMs: 4500 });
    await redis.ping();
    database.latencyMs = Math.max(1, Date.now() - startMs);
    database.status = 'connected';

    const [dbSizeVal, infoMemoryStr, activationIds, historyIds, adminUserRaw] = await Promise.all([
      redis.dbSize().catch(() => null),
      redis.info('memory').catch(() => null),
      redis.sMembers('activations').catch(() => []),
      redis.sMembers('history:esim:ids').catch(() => []),
      redis.get('user:admin').catch(() => null)
    ]);

    database.totalKeys = typeof dbSizeVal === 'number' ? dbSizeVal : null;
    const parsedMem = parseRedisInfoMemory(infoMemoryStr);
    database.evictionPolicy = parsedMem.evictionPolicy;

    const resolvedLimit = resolveLimitBytes(redisConfig.provider, parsedMem.maxMemory);
    database.limitBytes = resolvedLimit.limitBytes;
    database.limitSource = resolvedLimit.limitSource;

    if (Array.isArray(activationIds) && activationIds.length > 0) {
      const rawActivations = await redis.mGet(activationIds.map((id) => `activation:${id}`)).catch(() => []);
      for (const raw of rawActivations) {
        if (!raw) continue;
        records.activations.bytes += Buffer.byteLength(raw, 'utf8');
        try {
          const item = JSON.parse(raw);
          records.activations.total += 1;
          if (item.status === 'standby') records.activations.standby += 1;
          else if (item.status === 'processing') records.activations.processing += 1;
          else if (item.status === 'active') records.activations.active += 1;
        } catch {
          // Skip malformed entries
        }
      }
    }

    if (Array.isArray(historyIds) && historyIds.length > 0) {
      const rawHistory = await redis.mGet(historyIds.map((id) => `history:esim:${id}`)).catch(() => []);
      for (const raw of rawHistory) {
        if (!raw) continue;
        records.history.bytes += Buffer.byteLength(raw, 'utf8');
        records.history.total += 1;
      }
    }

    const shortlinkKeys = [];
    try {
      for await (const key of redis.scanIterator({ MATCH: 'shortlink:*', COUNT: 100 })) {
        shortlinkKeys.push(key);
        if (shortlinkKeys.length >= SHORTLINK_SCAN_CAP) break;
      }
    } catch {
      // Ignore scan error if provider restricts SCAN
    }

    records.shortlinks.total = shortlinkKeys.length;
    for (let i = 0; i < shortlinkKeys.length; i += 100) {
      const chunkKeys = shortlinkKeys.slice(i, i + 100);
      const chunkVals = await redis.mGet(chunkKeys).catch(() => []);
      chunkKeys.forEach((key, idx) => {
        const val = chunkVals[idx];
        records.shortlinks.bytes += Buffer.byteLength(String(key), 'utf8');
        if (typeof val === 'string') {
          records.shortlinks.bytes += Buffer.byteLength(val, 'utf8');
        }
      });
    }

    const userKeys = [];
    try {
      for await (const key of redis.scanIterator({ MATCH: 'user:*', COUNT: 100 })) {
        userKeys.push(key);
        if (userKeys.length >= USER_SCAN_CAP) break;
      }
    } catch {
      if (adminUserRaw) userKeys.push('user:admin');
    }

    records.users.total = userKeys.length;
    if (adminUserRaw) {
      records.users.hasAdmin = true;
      try {
        const adminObj = JSON.parse(adminUserRaw);
        records.users.usingDefaultPassword = Boolean(adminObj && !adminObj.passwordSetByUser);
      } catch {
        // Ignore parse error
      }
    }

    const payloadBytes =
      records.activations.bytes + records.history.bytes + records.shortlinks.bytes;
    database.usedBytes =
      typeof parsedMem.usedMemory === 'number' && parsedMem.usedMemory >= 0
        ? parsedMem.usedMemory
        : payloadBytes;

    await closeRedisClient(redis);
    redis = null;
  } catch (error) {
    await closeRedisClient(redis);
    database.status = !redisConfig.url || isRedisUnavailableError(error) && error.code === 'REDIS_NOT_CONFIGURED'
      ? 'unconfigured'
      : 'error';
    database.errorMessage = sanitizeDbError(error, Boolean(redisConfig.url));
  }

  const { overall, storagePercent, limits } = buildLimitsAndOverall(database, records, envMeta);
  database.usagePercent = storagePercent;

  return res.status(200).json({
    overall,
    checkedAt: new Date().toISOString(),
    runtime,
    database,
    records,
    env: envMeta.list,
    limits
  });
};
