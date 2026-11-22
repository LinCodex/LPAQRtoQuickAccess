export const HISTORY_MAX_ENTRIES = 500;
export const BYTES_PER_MIB = 1024 * 1024;
const CLEANUP_LAST_KEY = 'meta:cleanup:last';
const CLEANUP_COOLDOWN_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function getCleanupConfig() {
  const rawPct = Number(process.env.REDIS_CLEANUP_THRESHOLD_PERCENT);
  const thresholdPercent = Number.isFinite(rawPct) && rawPct > 0
    ? Math.max(50, Math.min(95, Math.round(rawPct)))
    : 80;
  const targetPercent = Math.max(40, thresholdPercent - 15);
  return {
    enabled: true,
    thresholdPercent,
    targetPercent,
    cooldownMs: CLEANUP_COOLDOWN_MS
  };
}

export function parseRedisInfoMemory(infoText) {
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

export function resolveLimitBytes(provider, maxMemoryParsed) {
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

export async function measureRedisMemory(redis, provider = 'Redis') {
  const infoText = await redis.info('memory').catch(() => null);
  const parsed = parseRedisInfoMemory(infoText);
  const resolved = resolveLimitBytes(provider, parsed.maxMemory);
  const usagePercent =
    typeof parsed.usedMemory === 'number' && resolved.limitBytes > 0
      ? Number(((parsed.usedMemory / resolved.limitBytes) * 100).toFixed(2))
      : null;

  return {
    usedMemory: parsed.usedMemory,
    maxMemory: parsed.maxMemory,
    evictionPolicy: parsed.evictionPolicy,
    limitBytes: resolved.limitBytes,
    limitSource: resolved.limitSource,
    usagePercent
  };
}

export async function getLastCleanupReport(redis) {
  try {
    const raw = await redis.get(CLEANUP_LAST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function estimateBytes(str) {
  return Buffer.byteLength(String(str || ''), 'utf8');
}

/**
 * Safely prune Redis keys when approaching capacity limits.
 * NEVER deletes user:* auth records, security:* keys, or meta:* keys.
 */
export async function runStorageCleanup(
  redis,
  { provider = 'Redis', reason = 'manual', force = false } = {}
) {
  const config = getCleanupConfig();
  const beforeMem = await measureRedisMemory(redis, provider);
  const deleted = {
    orphans: 0,
    ratelimits: 0,
    history: 0,
    shortlinks: 0,
    activations: 0
  };
  let freedBytesEstimate = 0;

  // Tier 1: Orphaned set members & stale rate-limit keys without TTL
  try {
    const actIds = await redis.sMembers('activations');
    if (Array.isArray(actIds) && actIds.length > 0) {
      for (let i = 0; i < actIds.length; i += 100) {
        const chunk = actIds.slice(i, i + 100);
        const vals = await redis.mGet(chunk.map((id) => `activation:${id}`));
        const stale = chunk.filter((_, idx) => !vals[idx]);
        if (stale.length > 0) {
          await redis.sRem('activations', stale);
          deleted.orphans += stale.length;
        }
      }
    }
  } catch {
    // Continue cleanup tiers
  }

  try {
    const histIds = await redis.sMembers('history:esim:ids');
    if (Array.isArray(histIds) && histIds.length > 0) {
      for (let i = 0; i < histIds.length; i += 100) {
        const chunk = histIds.slice(i, i + 100);
        const vals = await redis.mGet(chunk.map((id) => `history:esim:${id}`));
        const stale = chunk.filter((_, idx) => !vals[idx]);
        if (stale.length > 0) {
          await redis.sRem('history:esim:ids', stale);
          deleted.orphans += stale.length;
        }
      }
    }
  } catch {
    // Continue cleanup tiers
  }

  try {
    const rateKeys = [];
    for await (const key of redis.scanIterator({ MATCH: 'ratelimit:*', COUNT: 100 })) {
      rateKeys.push(key);
      if (rateKeys.length >= 500) break;
    }
    for (let i = 0; i < rateKeys.length; i += 50) {
      const chunk = rateKeys.slice(i, i + 50);
      const ttls = await Promise.all(chunk.map((k) => redis.ttl(k).catch(() => 0)));
      const staleRateKeys = chunk.filter((_, idx) => ttls[idx] === -1);
      if (staleRateKeys.length > 0) {
        await Promise.all(staleRateKeys.map((k) => redis.del(k)));
        deleted.ratelimits += staleRateKeys.length;
        freedBytesEstimate += staleRateKeys.length * 64;
      }
    }
  } catch {
    // Ignore scan restrictions
  }

  // Re-check usage after Tier 1
  let currentMem = await measureRedisMemory(redis, provider);

  // Tier 2: Enforce 500-entry history cap + prune oldest history entries under storage pressure
  try {
    const histIds = await redis.sMembers('history:esim:ids');
    if (Array.isArray(histIds) && histIds.length > 0) {
      const entries = [];
      const badIds = [];
      for (let i = 0; i < histIds.length; i += 100) {
        const chunk = histIds.slice(i, i + 100);
        const vals = await redis.mGet(chunk.map((id) => `history:esim:${id}`));
        chunk.forEach((id, idx) => {
          const raw = vals[idx];
          if (!raw) {
            badIds.push(id);
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            entries.push({
              id,
              createdAtMs: Date.parse(parsed.createdAt) || 0,
              bytes: estimateBytes(raw)
            });
          } catch {
            badIds.push(id);
          }
        });
      }

      if (badIds.length > 0) {
        await Promise.all([
          ...badIds.map((id) => redis.del(`history:esim:${id}`)),
          redis.sRem('history:esim:ids', badIds)
        ]);
        deleted.orphans += badIds.length;
      }

      entries.sort((a, b) => b.createdAtMs - a.createdAtMs);
      const toPrune = [];

      if (entries.length > HISTORY_MAX_ENTRIES) {
        toPrune.push(...entries.slice(HISTORY_MAX_ENTRIES));
      }

      const remaining = entries.slice(0, HISTORY_MAX_ENTRIES);
      const curPct = currentMem.usagePercent;
      const needsHistoryTrim =
        (curPct !== null && curPct >= config.thresholdPercent) ||
        (force && curPct !== null && curPct >= config.targetPercent);

      if (needsHistoryTrim && remaining.length > 0) {
        const minKeep = curPct !== null && curPct >= 90 ? 20 : 50;
        const removableCount = Math.max(0, remaining.length - minKeep);
        const pruneCount = Math.min(
          removableCount,
          Math.max(1, Math.ceil(remaining.length * 0.3))
        );
        if (pruneCount > 0) {
          toPrune.push(...remaining.slice(remaining.length - pruneCount));
        }
      }

      if (toPrune.length > 0) {
        const pruneIds = toPrune.map((e) => e.id);
        await Promise.all([
          ...pruneIds.map((id) => redis.del(`history:esim:${id}`)),
          redis.sRem('history:esim:ids', pruneIds)
        ]);
        deleted.history += pruneIds.length;
        freedBytesEstimate += toPrune.reduce((sum, e) => sum + e.bytes, 0);
      }
    }
  } catch {
    // Continue to Tier 3
  }

  // Tier 3: Oldest / soonest-expiring short links if still at/above threshold
  currentMem = await measureRedisMemory(redis, provider);
  const curPctAfterHist = currentMem.usagePercent;
  const needsShortlinkTrim =
    (curPctAfterHist !== null && curPctAfterHist >= config.thresholdPercent) ||
    (force && curPctAfterHist !== null && curPctAfterHist >= config.targetPercent);

  if (needsShortlinkTrim) {
    try {
      const shortKeys = [];
      for await (const key of redis.scanIterator({ MATCH: 'shortlink:*', COUNT: 100 })) {
        shortKeys.push(key);
        if (shortKeys.length >= 2000) break;
      }

      if (shortKeys.length > 0) {
        const items = [];
        for (let i = 0; i < shortKeys.length; i += 50) {
          const chunk = shortKeys.slice(i, i + 50);
          const [ttls, vals] = await Promise.all([
            Promise.all(chunk.map((k) => redis.ttl(k).catch(() => Number.MAX_SAFE_INTEGER))),
            redis.mGet(chunk).catch(() => [])
          ]);
          chunk.forEach((key, idx) => {
            const ttlVal = ttls[idx];
            // Sort leaked no-TTL (-1) keys first, then smallest remaining TTL
            const sortScore = ttlVal === -1 ? -1 : ttlVal;
            items.push({
              key,
              sortScore,
              bytes: estimateBytes(key) + estimateBytes(vals[idx])
            });
          });
        }

        items.sort((a, b) => a.sortScore - b.sortScore);
        const batchSize =
          items.length >= 10
            ? Math.max(10, Math.ceil(items.length * 0.25))
            : items.length;
        const victimItems = items.slice(0, batchSize);
        if (victimItems.length > 0) {
          await Promise.all(victimItems.map((item) => redis.del(item.key)));
          deleted.shortlinks += victimItems.length;
          freedBytesEstimate += victimItems.reduce((sum, item) => sum + item.bytes, 0);
        }
      }
    } catch {
      // Continue to Tier 4
    }
  }

  // Tier 4: Emergency old completed activation cleanup only when >= 85%
  currentMem = await measureRedisMemory(redis, provider);
  const curPctEmergency = currentMem.usagePercent;
  if (curPctEmergency !== null && curPctEmergency >= 85) {
    try {
      const actIds = await redis.sMembers('activations');
      if (Array.isArray(actIds) && actIds.length > 0) {
        const records = [];
        for (let i = 0; i < actIds.length; i += 100) {
          const chunk = actIds.slice(i, i + 100);
          const vals = await redis.mGet(chunk.map((id) => `activation:${id}`));
          chunk.forEach((id, idx) => {
            const raw = vals[idx];
            if (!raw) return;
            try {
              const parsed = JSON.parse(raw);
              const ts = Date.parse(parsed.updatedAt || parsed.createdAt) || 0;
              records.push({
                id,
                status: parsed.status || 'standby',
                ts,
                bytes: estimateBytes(raw)
              });
            } catch {
              // Skip unparseable records
            }
          });
        }

        const nowMs = Date.now();
        records.sort((a, b) => a.ts - b.ts);
        let candidates = records.filter(
          (r) => r.status === 'active' && nowMs - r.ts >= 30 * DAY_MS
        );
        if (curPctEmergency >= 90) {
          candidates = records.filter(
            (r) =>
              (r.status === 'active' && nowMs - r.ts >= 7 * DAY_MS) ||
              nowMs - r.ts >= 60 * DAY_MS
          );
        }

        const maxBatch = Math.max(1, Math.ceil(records.length * 0.25));
        const pruneActivations = candidates.slice(0, maxBatch);
        if (pruneActivations.length > 0) {
          const pruneIds = pruneActivations.map((a) => a.id);
          await Promise.all([
            ...pruneIds.map((id) => redis.del(`activation:${id}`)),
            redis.sRem('activations', pruneIds)
          ]);
          deleted.activations += pruneIds.length;
          freedBytesEstimate += pruneActivations.reduce((sum, a) => sum + a.bytes, 0);
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  const afterMem = await measureRedisMemory(redis, provider);
  const totalDeleted =
    deleted.orphans +
    deleted.ratelimits +
    deleted.history +
    deleted.shortlinks +
    deleted.activations;

  const report = {
    ranAt: new Date().toISOString(),
    reason,
    thresholdPercent: config.thresholdPercent,
    targetPercent: config.targetPercent,
    usageBeforePercent: beforeMem.usagePercent,
    usageAfterPercent: afterMem.usagePercent,
    deleted,
    totalDeleted,
    freedBytesEstimate
  };

  try {
    await redis.set(CLEANUP_LAST_KEY, JSON.stringify(report));
  } catch {
    // Non-fatal if saving metadata fails under OOM
  }

  return report;
}

/**
 * Throttled pre-write check: triggers cleanup automatically if Redis usage hits threshold.
 * Never throws so normal application writes still succeed.
 */
export async function autoCleanupIfNeeded(redis, provider = 'Redis') {
  try {
    const config = getCleanupConfig();
    const last = await getLastCleanupReport(redis);
    if (last && last.ranAt) {
      const elapsed = Date.now() - Date.parse(last.ranAt);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < config.cooldownMs) {
        return null;
      }
    }

    const mem = await measureRedisMemory(redis, provider);
    if (mem.usagePercent !== null && mem.usagePercent >= config.thresholdPercent) {
      return await runStorageCleanup(redis, {
        provider,
        reason: 'auto-threshold',
        force: false
      });
    }
  } catch {
    // Never break write operations
  }
  return null;
}
