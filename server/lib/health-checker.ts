import { createLogger } from "./logger.js";
import { listKeys } from "./secret-store.js";
import { listGroups } from "./group-store.js";
import { adapter } from "./dashscope-adapter.js";
import { recordHealthCheck, purgeOldHealthChecks } from "./health-check-store.js";
import { markModelUnavailable, markModelAvailable } from "./model-availability-store.js";
import type { ApiKeyWithSecret, ModelGroup } from "./types.js";

const log = createLogger("health-checker");

let healthCheckInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export interface HealthCheckConfig {
  intervalHours: number;
  enabled: boolean;
}

const defaultConfig: HealthCheckConfig = {
  intervalHours: 3,
  enabled: true,
};

/**
 * Start the periodic health checker.
 */
export function startHealthChecker(config: HealthCheckConfig = defaultConfig): void {
  if (!config.enabled) {
    log.info("Health checker disabled");
    return;
  }

  if (healthCheckInterval) {
    log.warn("Health checker already running");
    return;
  }

  const intervalMs = config.intervalHours * 60 * 60 * 1000;
  log.info("Starting health checker", { intervalHours: config.intervalHours });

  // Run immediately on startup
  setTimeout(() => runAllHealthChecks(), 5000);

  // Then run periodically
  healthCheckInterval = setInterval(() => {
    runAllHealthChecks();
  }, intervalMs);
}

/**
 * Stop the periodic health checker.
 */
export function stopHealthChecker(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    log.info("Health checker stopped");
  }
}

/**
 * Run health checks for all keys and models.
 */
export async function runAllHealthChecks(): Promise<void> {
  if (isRunning) {
    log.warn("Health check already in progress, skipping");
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  log.info("Starting health check cycle");

  try {
    const keys = listKeys().filter((k) => k.enabled && k.status !== "invalid" && k.status !== "disabled");
    const groups = listGroups().filter((g) => g.enabled);

    log.info("Health check scope", { keys: keys.length, groups: groups.length });

    let totalChecks = 0;
    let passedChecks = 0;
    let failedChecks = 0;

    for (const group of groups) {
      for (const candidate of group.candidates) {
        // Find a key that has this group
        const eligibleKeys = keys.filter((k) => k.groups.includes(group.id));
        if (eligibleKeys.length === 0) continue;

        // Test with first available key
        const testKey = eligibleKeys[0];
        const keyWithSecret = await getKeyWithSecretSafe(testKey.id);
        if (!keyWithSecret) continue;

        const result = await testModelHealth(keyWithSecret, candidate.upstream_model_id);
        totalChecks++;

        if (result.success) {
          passedChecks++;
          markModelAvailable(testKey.id, candidate.upstream_model_id);
        } else {
          failedChecks++;
          if (result.errorCode === "insufficient_quota" || result.errorCode === "AccessDenied.Unpurchased") {
            markModelUnavailable(testKey.id, candidate.upstream_model_id, result.errorCode || "unknown", result.errorMessage || "");
          }
        }

        recordHealthCheck({
          api_key_id: testKey.id,
          upstream_model_id: candidate.upstream_model_id,
          success: result.success,
          status_code: result.statusCode,
          error_code: result.errorCode,
          error_message: result.errorMessage,
          latency_ms: result.latencyMs,
        });

        // Small delay to avoid hammering upstream
        await sleep(100);
      }
    }

    // Purge old health check records
    purgeOldHealthChecks(7);

    const duration = Date.now() - startTime;
    log.info("Health check cycle complete", {
      duration_ms: duration,
      total: totalChecks,
      passed: passedChecks,
      failed: failedChecks,
    });
  } catch (err) {
    log.error("Health check cycle failed", { error: (err as Error).message });
  } finally {
    isRunning = false;
  }
}

/**
 * Test a single key+model combo.
 */
export async function testModelHealth(
  key: ApiKeyWithSecret,
  modelId: string,
): Promise<{
  success: boolean;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  latencyMs?: number;
}> {
  const startTime = Date.now();

  try {
    // Simple chat completion with minimal tokens
    const response = await adapter.chatCompletions(
      {
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      },
      key,
      10000, // 10s timeout
    );

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      return { success: true, statusCode: response.status, latencyMs };
    }

    const error = await adapter.parseError(response);
    return {
      success: false,
      statusCode: error.status,
      errorCode: error.code,
      errorMessage: error.message,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      errorCode: err.code || "network_error",
      errorMessage: err.message || String(err),
      latencyMs,
    };
  }
}

/**
 * Run health check for a specific key (manual trigger).
 */
export async function runHealthCheck(keyId: string): Promise<{
  tested: number;
  passed: number;
  failed: number;
}> {
  const keys = listKeys();
  const key = keys.find((k) => k.id === keyId);
  if (!key) throw new Error(`Key ${keyId} not found`);

  const keyWithSecret = await getKeyWithSecretSafe(keyId);
  if (!keyWithSecret) throw new Error(`Failed to decrypt key ${keyId}`);

  const groups = listGroups().filter((g) => g.enabled && g.key_ids.includes(keyId));
  const models = new Set<string>();
  for (const group of groups) {
    for (const candidate of group.candidates) {
      models.add(candidate.upstream_model_id);
    }
  }

  let tested = 0;
  let passed = 0;
  let failed = 0;

  for (const modelId of Array.from(models)) {
    const result = await testModelHealth(keyWithSecret, modelId);
    tested++;

    if (result.success) {
      passed++;
      markModelAvailable(keyId, modelId);
    } else {
      failed++;
      if (result.errorCode === "insufficient_quota" || result.errorCode === "AccessDenied.Unpurchased") {
        markModelUnavailable(keyId, modelId, result.errorCode || "unknown", result.errorMessage || "");
      }
    }

    recordHealthCheck({
      api_key_id: keyId,
      upstream_model_id: modelId,
      success: result.success,
      status_code: result.statusCode,
      error_code: result.errorCode,
      error_message: result.errorMessage,
      latency_ms: result.latencyMs,
    });

    await sleep(100);
  }

  return { tested, passed, failed };
}

async function getKeyWithSecretSafe(keyId: string): Promise<ApiKeyWithSecret | null> {
  try {
    const { getKeyWithSecret } = await import("./secret-store.js");
    return getKeyWithSecret(keyId);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
