import { createLogger } from "./logger.js";
import { getDb } from "./database.js";
import { generateId } from "./ids.js";
import type { TelemetrySource } from "./types.js";

const log = createLogger("quota-guard");

/**
 * Token bucket rate limiter per API key.
 * Tracks local request counts when upstream quota headers are unavailable.
 */
interface TokenBucket {
  capacity: number;
  tokens: number;
  lastRefill: number;
  refillRate: number; // tokens per second
}

const buckets: Record<string, TokenBucket> = {};

export interface QuotaCheckResult {
  allowed: boolean;
  remaining: number | null;
  source: TelemetrySource;
}

/**
 * Check if a request is allowed under the rate/quota limits.
 * Uses upstream quota snapshot if available, falls back to local token bucket.
 */
export function checkQuota(apiKeyId: string): QuotaCheckResult {
  const db = getDb();

  // Check for active upstream quota snapshot first
  const snapshot = db.prepare(`
    SELECT * FROM quota_snapshots
    WHERE api_key_id = ? AND expires_at > datetime('now')
    ORDER BY observed_at DESC LIMIT 1
  `).get(apiKeyId) as any;

  if (snapshot && snapshot.rpm_remaining !== null) {
    const allowed = snapshot.rpm_remaining > 0;
    return {
      allowed,
      remaining: snapshot.rpm_remaining,
      source: snapshot.source as TelemetrySource,
    };
  }

  // Fallback to local token bucket
  return checkLocalBucket(apiKeyId);
}

/**
 * Decrement quota after a successful request.
 */
export function consumeQuota(apiKeyId: string): void {
  // Update local bucket
  const bucket = buckets[apiKeyId];
  if (bucket) {
    bucket.tokens = Math.max(0, bucket.tokens - 1);
  }

  // Decrement upstream snapshot if exists
  const db = getDb();
  const snapshot = db.prepare(`
    SELECT id, rpm_remaining FROM quota_snapshots
    WHERE api_key_id = ? AND expires_at > datetime('now')
    ORDER BY observed_at DESC LIMIT 1
  `).get(apiKeyId) as any;

  if (snapshot && snapshot.rpm_remaining !== null && snapshot.rpm_remaining > 0) {
    db.prepare("UPDATE quota_snapshots SET rpm_remaining = rpm_remaining - 1 WHERE id = ?").run(snapshot.id);
  }
}

/**
 * Record upstream quota info from response headers or API.
 */
export function recordQuotaSnapshot(
  apiKeyId: string,
  upstreamModelId: string | null,
  hints: {
    rpmLimit?: number | null;
    rpmRemaining?: number | null;
    tpmLimit?: number | null;
    tpmRemaining?: number | null;
    dailyLimit?: number | null;
    dailyRemaining?: number | null;
  },
  source: TelemetrySource,
  ttlSeconds: number = 300,
): void {
  const db = getDb();
  const id = generateId("quota");

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  db.prepare(`
    INSERT INTO quota_snapshots (
      id, api_key_id, upstream_model_id,
      rpm_limit, rpm_remaining, tpm_limit, tpm_remaining,
      daily_limit, daily_remaining, source, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    apiKeyId,
    upstreamModelId,
    hints.rpmLimit ?? null,
    hints.rpmRemaining ?? null,
    hints.tpmLimit ?? null,
    hints.tpmRemaining ?? null,
    hints.dailyLimit ?? null,
    hints.dailyRemaining ?? null,
    source,
    expiresAt,
  );

  // Also sync local bucket capacity if we got upstream limits
  if (hints.rpmLimit) {
    initBucket(apiKeyId, hints.rpmLimit, hints.rpmLimit / 60);
  }

  log.debug("Quota snapshot recorded", {
    apiKeyId,
    source,
    rpmRemaining: hints.rpmRemaining,
    ttlSeconds,
  });
}

function initBucket(apiKeyId: string, capacity: number, refillRate: number): TokenBucket {
  if (!buckets[apiKeyId] || buckets[apiKeyId].capacity !== capacity) {
    buckets[apiKeyId] = {
      capacity,
      tokens: capacity,
      lastRefill: Date.now(),
      refillRate,
    };
  }
  return buckets[apiKeyId];
}

function checkLocalBucket(apiKeyId: string): QuotaCheckResult {
  const bucket = buckets[apiKeyId];

  if (!bucket) {
    // No limits configured — allow
    return { allowed: true, remaining: null, source: "unknown" };
  }

  // Refill tokens based on elapsed time
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRate);
  bucket.lastRefill = now;

  return {
    allowed: bucket.tokens >= 1,
    remaining: Math.floor(bucket.tokens),
    source: "local_estimate",
  };
}

/**
 * Initialize a local token bucket for a key (used when no upstream quota info available).
 * Default: 60 RPM for standard keys, 20 RPM for coding plan.
 */
export function initLocalQuota(
  apiKeyId: string,
  rpmLimit: number = 60,
): void {
  const refillRate = rpmLimit / 60; // tokens per second
  initBucket(apiKeyId, rpmLimit, refillRate);
  log.info("Local quota initialized", { apiKeyId, rpmLimit });
}
