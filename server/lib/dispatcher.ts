import { createLogger } from "./logger.js";
import { getKeysForDispatch, updateKey } from "./secret-store.js";
import { getDb } from "./database.js";
import { trialExhausted, getTrialQuota } from "./trial-store.js";
import type { ApiKeyWithSecret, SelectionStrategy } from "./types.js";

const log = createLogger("dispatcher");

const roundRobinCounters: Record<string, number> = {};

/**
 * Pick the next key for a group.
 *
 * When `trialModel` is set (Trial Farm mode), keys whose free-trial quota for
 * that specific model is exhausted are skipped. If *every* tracked key is
 * exhausted, returns null so callers can surface a clear "trial exhausted"
 * error instead of silently burning paid quota. Keys with no trial row for
 * the model are unaffected.
 *
 * For first_available, live keys are additionally ordered by soonest trial
 * expiry — burn the quotas that die first.
 */
export function dispatchKey(
  groupId: string,
  strategy: SelectionStrategy,
  weights?: Record<string, number>,
  trialModel?: string,
): ApiKeyWithSecret | null {
  let keys = getKeysForDispatch(groupId);

  if (keys.length === 0) {
    log.warn("No eligible keys for group", { groupId });
    return null;
  }

  if (trialModel) {
    const live = keys.filter((k) => !trialExhausted(k.id, trialModel));
    const anyTracked = keys.some((k) => getTrialQuota(k.id, trialModel) !== null);

    if (live.length > 0) {
      keys = live;
      if (strategy === "first_available") {
        const expiry = (k: ApiKeyWithSecret) => {
          const q = getTrialQuota(k.id, trialModel);
          return q?.expires_at ? new Date(q.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
        };
        keys = [...keys].sort((a, b) => expiry(a) - expiry(b));
      }
    } else if (anyTracked) {
      log.warn("All trial quotas exhausted for model", { groupId, trialModel, eligibleKeys: keys.length });
      return null;
    }
  }

  switch (strategy) {
    case "first_available":
      return keys[0];

    case "round_robin":
      return roundRobin(groupId, keys);

    case "least_recently_used":
      return leastRecentlyUsed(keys);

    case "weighted":
      return weightedRandom(keys, weights || {});

    default:
      return keys[0];
  }
}

function roundRobin(groupId: string, keys: ApiKeyWithSecret[]): ApiKeyWithSecret {
  const idx = (roundRobinCounters[groupId] || 0) % keys.length;
  roundRobinCounters[groupId] = idx + 1;
  return keys[idx];
}

function leastRecentlyUsed(keys: ApiKeyWithSecret[]): ApiKeyWithSecret {
  let oldest: ApiKeyWithSecret = keys[0];
  let oldestTime = Infinity;

  for (const key of keys) {
    const lastUsed = key.last_validated_at
      ? new Date(key.last_validated_at).getTime()
      : 0;
    if (lastUsed < oldestTime) {
      oldestTime = lastUsed;
      oldest = key;
    }
  }

  return oldest;
}

function weightedRandom(
  keys: ApiKeyWithSecret[],
  weights: Record<string, number>,
): ApiKeyWithSecret {
  const totalWeight = keys.reduce(
    (sum, key) => sum + (weights[key.id] || 1),
    0,
  );

  let random = Math.random() * totalWeight;

  for (const key of keys) {
    random -= weights[key.id] || 1;
    if (random <= 0) return key;
  }

  return keys[keys.length - 1];
}

export function markKeyCooldown(
  keyId: string,
  cooldownSeconds: number,
  errorCode: string,
  errorMessage: string,
): void {
  const cooldownUntil = new Date(
    Date.now() + cooldownSeconds * 1000,
  ).toISOString();

  updateKey(keyId, {
    status: "rate_limited",
    cooldown_until: cooldownUntil,
    last_error_code: errorCode,
    last_error_message: errorMessage,
  });

  log.info("Key placed in cooldown", {
    keyId,
    cooldownSeconds,
    errorCode,
    cooldownUntil,
  });
}

export function markKeyStatus(
  keyId: string,
  status: "invalid" | "quota_exhausted" | "disabled" | "active",
  errorCode?: string,
  errorMessage?: string,
): void {
  const updates: any = {
    status,
    last_error_code: errorCode || null,
    last_error_message: errorMessage || null,
    consecutive_failures: status === "active" ? 0 : undefined,
    last_validated_at: new Date().toISOString(),
  };

  if (status === "quota_exhausted") {
    const cooldownUntil = new Date(Date.now() + 300_000).toISOString();
    updates.cooldown_until = cooldownUntil;
  }

  updateKey(keyId, updates);

  log.info("Key status updated", { keyId, status, errorCode });
}

export function incrementKeyFailure(keyId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT consecutive_failures FROM api_keys WHERE id = ?")
    .get(keyId) as any;
  const failures = (row?.consecutive_failures || 0) + 1;
  db.prepare("UPDATE api_keys SET consecutive_failures = ?, updated_at = datetime('now') WHERE id = ?").run(
    failures,
    keyId,
  );

  if (failures >= 5) {
    markKeyCooldown(keyId, 60, "circuit_breaker", `${failures} consecutive failures`);
  }

  return failures;
}
