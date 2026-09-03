/**
 * Sliding-window rate limiter (in-memory, per identifier).
 *
 * Used to enforce requests-per-minute limits on virtual client keys.
 * Window state is process-local, which is fine for the single-node
 * deployment model Aliproxy targets.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number | null;
  remaining: number;
  retry_after_seconds: number;
}

export function checkRateLimit(
  identifier: string,
  limitPerMinute: number | null,
  nowMs: number = Date.now(),
): RateLimitResult {
  if (!limitPerMinute || limitPerMinute <= 0) {
    return { allowed: true, limit: null, remaining: Number.MAX_SAFE_INTEGER, retry_after_seconds: 0 };
  }

  const windowStart = nowMs - 60_000;
  const existing = (buckets.get(identifier) || []).filter((ts) => ts > windowStart);

  if (existing.length >= limitPerMinute) {
    const oldest = existing[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + 60_000 - nowMs) / 1000));
    buckets.set(identifier, existing);
    return { allowed: false, limit: limitPerMinute, remaining: 0, retry_after_seconds: retryAfter };
  }

  existing.push(nowMs);
  buckets.set(identifier, existing);
  return {
    allowed: true,
    limit: limitPerMinute,
    remaining: limitPerMinute - existing.length,
    retry_after_seconds: 0,
  };
}

/** Test helper: clear one or all buckets. */
export function resetRateLimiter(identifier?: string): void {
  if (identifier) buckets.delete(identifier);
  else buckets.clear();
}
