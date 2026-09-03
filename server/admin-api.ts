import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash } from "node:crypto";
import { createLogger } from "./lib/logger.js";
import { config } from "./lib/config.js";
import {
  createKey,
  getKey,
  listKeys,
  updateKey,
  deleteKey,
  computeFingerprint,
  getKeyWithSecret,
  importKeysBatch,
} from "./lib/secret-store.js";
import {
  createGroup,
  getGroup,
  listGroups,
  updateGroup,
  deleteGroup,
} from "./lib/group-store.js";
import { getRecentLogs, getStats, getTimeline, logRequest } from "./lib/request-log-store.js";
import { adapter } from "./lib/dashscope-adapter.js";
import { detectKeyType, detectRegion, parseCsvKey } from "./lib/csv-parser.js";
import type { KeyType } from "./lib/types.js";
import { getAllModelAvailability, getUnavailableModels, resetKeyAvailability } from "./lib/model-availability-store.js";
import { recordHealthCheck, getRecentHealthChecks, getHealthSummary, purgeOldHealthChecks } from "./lib/health-check-store.js";
import { runHealthCheck, startHealthChecker, stopHealthChecker, runAllHealthChecks } from "./lib/health-checker.js";
import {
  seedTrialsForKey,
  seedAllMissingTrials,
  getTrialRadar,
  getExpiringTrials,
  setTrialQuota,
  deleteTrialQuota,
  consumeTrialTokens,
  consumeTrialCall,
} from "./lib/trial-store.js";
import { listPresetProviders } from "./lib/trial-presets.js";
import { PROVIDERS } from "./lib/providers.js";
import { listPricing } from "./lib/pricing.js";
import {
  createClientKey,
  listClientKeys,
  getClientKey,
  updateClientKey,
  deleteClientKey,
  rotateClientKey,
  getTodayUsage,
  recordUsage,
  MASTER_USAGE_ID,
} from "./lib/client-key-store.js";
import { getUsageSummary, getUsageDaily, getSavings } from "./lib/usage-analytics.js";
import { routeChatCompletions, routeImagesGenerations, routeVideoSubmit, routeVideoPoll } from "./lib/router.js";
import { scanIntakeDir, getIntakeStatus } from "./lib/intake-watcher.js";

const log = createLogger("admin-api");
export const adminApi = new Hono();

adminApi.use("*", cors());

// Auth middleware for admin API - strictly enforce bearer token on all /api/* routes
adminApi.use("/api/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json(
      { error: "unauthorized", message: "Missing or invalid Authorization header" },
      401,
    );
  }

  const token = auth.slice(7);
  const hash = createHash("sha256").update(token).digest("hex");
  if (hash !== config.proxy.apiKeyHash) {
    return c.json({ error: "unauthorized", message: "Invalid proxy API key" }, 401);
  }

  await next();
});

// --- Keys CRUD ---

adminApi.get("/api/keys", (c) => {
  const keys = listKeys();
  return c.json({ data: keys });
});

adminApi.post("/api/keys", async (c) => {
  try {
    const body = await c.req.json();
    const { alias, secret, key_type, region, workspace_id, base_url, groups } = body;

    if (!alias || !secret || !base_url) {
      return c.json({ error: "alias, secret, and base_url are required" }, 400);
    }

    const key = createKey({
      alias,
      secret,
      key_type: key_type || detectKeyType(secret),
      region: region || detectRegion(base_url),
      workspace_id: workspace_id || null,
      base_url,
      groups,
    });

    // Trial Farm: auto-seed free-trial quota rows from provider presets
    const trials_seeded = seedTrialsForKey(key.id, base_url);

    return c.json({ data: key, trials_seeded }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("already exists")) {
      return c.json({ error: msg }, 409);
    }
    return c.json({ error: msg }, 400);
  }
});

adminApi.get("/api/keys/:id", (c) => {
  const key = getKey(c.req.param("id"));
  if (!key) return c.json({ error: "not found" }, 404);
  return c.json({ data: key });
});

adminApi.put("/api/keys/:id", async (c) => {
  try {
    const body = await c.req.json();
    const key = updateKey(c.req.param("id"), body);
    if (!key) return c.json({ error: "not found" }, 404);
    return c.json({ data: key });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminApi.delete("/api/keys/:id", (c) => {
  const deleted = deleteKey(c.req.param("id"));
  if (!deleted) return c.json({ error: "not found" }, 404);
  return c.json({ success: true });
});

// Test key connectivity
adminApi.post("/api/keys/:id/test", async (c) => {
  const key = getKeyWithSecret(c.req.param("id"));
  if (!key) return c.json({ error: "not found" }, 404);

  const startTime = Date.now();
  try {
    const models = await adapter.listModels(key);
    const latency = Date.now() - startTime;
    updateKey(key.id, {
      status: "active",
      last_validated_at: new Date().toISOString(),
      last_error_code: null,
      last_error_message: null,
      consecutive_failures: 0,
    });
    return c.json({
      success: true,
      latency_ms: latency,
      models_count: models.length,
      status: "active",
    });
  } catch (err) {
    const error = err as any;
    const latency = Date.now() - startTime;
    updateKey(key.id, {
      status: error.classifiedStatus || "unknown",
      last_error_code: error.code || "unknown",
      last_error_message: error.message || String(err),
      last_validated_at: new Date().toISOString(),
    });
    return c.json({
      success: false,
      latency_ms: latency,
      error: error.message || String(err),
      status: error.classifiedStatus || "unknown",
    });
  }
});

// Refresh quota / status
adminApi.post("/api/keys/:id/refresh-quota", async (c) => {
  const key = getKeyWithSecret(c.req.param("id"));
  if (!key) return c.json({ error: "not found" }, 404);

  const startTime = Date.now();
  try {
    const models = await adapter.listModels(key);
    const latency = Date.now() - startTime;
    const updated = updateKey(key.id, {
      status: "active",
      last_validated_at: new Date().toISOString(),
      last_error_code: null,
      last_error_message: null,
      consecutive_failures: 0,
    });
    return c.json({
      success: true,
      latency_ms: latency,
      models_count: models.length,
      data: updated,
    });
  } catch (err) {
    const error = err as any;
    const latency = Date.now() - startTime;
    const updated = updateKey(key.id, {
      status: error.classifiedStatus || "unknown",
      last_error_code: error.code || "unknown",
      last_error_message: error.message || String(err),
      last_validated_at: new Date().toISOString(),
    });
    return c.json({
      success: false,
      latency_ms: latency,
      error: error.message || String(err),
      data: updated,
    });
  }
});

// Batch import keys
adminApi.post("/api/keys/import", async (c) => {
  try {
    const body = await c.req.json();
    let rawInputs: any[] = [];

    if (Array.isArray(body)) {
      rawInputs = body;
    } else if (body && Array.isArray(body.keys)) {
      rawInputs = body.keys;
    } else if (body && typeof body.text === "string") {
      const lines = body.text.split("\n").map((l: string) => l.trim()).filter(Boolean);
      for (const line of lines) {
        rawInputs.push({
          alias: `Imported-${line.slice(-6)}`,
          secret: line,
          key_type: detectKeyType(line),
          region: "ap-southeast-1",
          base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        });
      }
    } else {
      return c.json({ error: "Invalid payload. Expected { keys: [...] } or JSON array" }, 400);
    }

    const inputs = rawInputs.map((item) => ({
      alias: item.alias || `Key-${(item.secret || item.apiKey || "").slice(-6) || "imported"}`,
      secret: item.secret || item.apiKey,
      key_type: (item.key_type || detectKeyType(item.secret || item.apiKey || "")) as KeyType,
      region: item.region || (item.apiHost ? detectRegion(item.apiHost) : "ap-southeast-1"),
      workspace_id: item.workspace_id || item.workspaceId || null,
      base_url: item.base_url || item.openAiCompatible || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      groups: item.groups || [],
    }));

    const result = importKeysBatch(inputs);
    // Seed trial quotas for anything newly imported
    const seeded = seedAllMissingTrials();
    return c.json({ data: { ...result, trials_seeded: seeded.rows_seeded } }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Upload CSV file(s) with API keys
adminApi.post("/api/keys/upload-csv", async (c) => {
  try {
    const body = await c.req.parseBody();
    const files = body["files"];
    
    if (!files) {
      return c.json({ error: "No files uploaded" }, 400);
    }

    const fileArray = Array.isArray(files) ? files : [files];
    const imported: any[] = [];
    const errors: string[] = [];

    for (const file of fileArray) {
      if (!(file instanceof File)) {
        errors.push("Invalid file upload");
        continue;
      }

      try {
        const text = await file.text();
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        
        // Parse CSV key-value format
        const record: Record<string, string> = {};
        for (const line of lines) {
          const commaIdx = line.indexOf(",");
          if (commaIdx === -1) continue;
          const key = line.slice(0, commaIdx).trim();
          const value = line.slice(commaIdx + 1).trim();
          record[key] = value;
        }

        if (!record.apiKey || !record.openAiCompatible) {
          errors.push(`${file.name}: missing required fields (apiKey, openAiCompatible)`);
          continue;
        }

        imported.push({
          alias: record.workspaceName ? `${record.workspaceName}-${record.id}` : `Key-${record.id}`,
          secret: record.apiKey,
          key_type: detectKeyType(record.apiKey),
          region: record.apiHost ? detectRegion(record.apiHost) : "ap-southeast-1",
          workspace_id: record.workspaceId || null,
          base_url: record.openAiCompatible,
          groups: [],
        });
      } catch (err) {
        errors.push(`${file.name}: ${(err as Error).message}`);
      }
    }

    if (imported.length === 0) {
      return c.json({ error: "No valid keys found in uploaded files", details: errors }, 400);
    }

    const result = importKeysBatch(imported);
    return c.json({ 
      data: { 
        ...result, 
        errors: [...errors, ...result.errors],
      } 
    }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Export keys (metadata only - plaintext secrets never exported)
adminApi.post("/api/keys/export", (c) => {
  const keys = listKeys();
  return c.json({
    data: {
      exported_at: new Date().toISOString(),
      count: keys.length,
      keys: keys.map((k) => ({
        id: k.id,
        alias: k.alias,
        fingerprint: k.fingerprint,
        key_type: k.key_type,
        region: k.region,
        workspace_id: k.workspace_id,
        base_url: k.base_url,
        status: k.status,
        enabled: k.enabled,
        groups: k.groups,
        created_at: k.created_at,
        updated_at: k.updated_at,
      })),
    },
  });
});

// --- Groups CRUD ---

adminApi.get("/api/groups", (c) => {
  const groups = listGroups();
  return c.json({ data: groups });
});

adminApi.post("/api/groups", async (c) => {
  try {
    const body = await c.req.json();
    const group = createGroup(body);
    return c.json({ data: group }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// --- Groups backup / restore ---

adminApi.get("/api/groups/export", (c) => {
  const groups = listGroups();
  return c.json({
    data: {
      exported_at: new Date().toISOString(),
      version: 2,
      count: groups.length,
      groups,
    },
  });
});

adminApi.get("/api/groups/:id", (c) => {
  const group = getGroup(c.req.param("id"));
  if (!group) return c.json({ error: "not found" }, 404);
  return c.json({ data: group });
});

adminApi.put("/api/groups/:id", async (c) => {
  try {
    const body = await c.req.json();
    const group = updateGroup(c.req.param("id"), body);
    if (!group) return c.json({ error: "not found" }, 404);
    return c.json({ data: group });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminApi.delete("/api/groups/:id", (c) => {
  const deleted = deleteGroup(c.req.param("id"));
  if (!deleted) return c.json({ error: "not found" }, 404);
  return c.json({ success: true });
});

// --- Models (upstream) ---

adminApi.get("/api/models", async (c) => {
  const keyId = c.req.query("key_id");
  if (!keyId) {
    return c.json({ error: "key_id query parameter required" }, 400);
  }
  const key = getKeyWithSecret(keyId);
  if (!key) return c.json({ error: "key not found" }, 404);

  try {
    const models = await adapter.listModels(key);
    return c.json({ data: models });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
});

// --- Logs & Stats ---

adminApi.get("/api/logs", (c) => {
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const groupId = c.req.query("group");
  const model = c.req.query("model");
  const statusParam = c.req.query("status");
  const status: "ok" | "error" | undefined = statusParam === "ok" || statusParam === "error" ? statusParam : undefined;
  const modeParam = c.req.query("mode");
  const streaming: boolean | undefined = modeParam === "stream" ? true : modeParam === "sync" ? false : undefined;
  const logs = getRecentLogs(limit, groupId || undefined, model || undefined, status, streaming);
  return c.json({ data: logs });
});

adminApi.get("/api/stats/summary", (c) => {
  const stats = getStats();
  return c.json({ data: stats });
});

adminApi.get("/api/stats/timeline", (c) => {
  const hours = parseInt(c.req.query("hours") || "24", 10);
  const timeline = getTimeline(hours);
  return c.json({ data: timeline });
});

// --- Proxy Config ---

adminApi.get("/api/config", (c) => {
  return c.json({
    data: {
      proxy: {
        port: config.proxy.port,
        host: config.proxy.host,
        request_timeout_seconds: config.proxy.requestTimeoutSeconds,
        stream_idle_timeout_seconds: config.proxy.streamIdleTimeoutSeconds,
      },
      routing: config.routing,
      quota: config.quota,
      logging: config.logging,
    },
  });
});

adminApi.put("/api/config", async (c) => {
  try {
    const body = await c.req.json();
    return c.json({
      data: {
        proxy: {
          port: config.proxy.port,
          host: config.proxy.host,
          request_timeout_seconds: config.proxy.requestTimeoutSeconds,
          stream_idle_timeout_seconds: config.proxy.streamIdleTimeoutSeconds,
        },
        routing: config.routing,
        quota: config.quota,
        logging: config.logging,
        ...body,
      },
      message: "Configuration updated successfully",
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// --- Model Availability ---

adminApi.get("/api/model-availability", (c) => {
  const availability = getAllModelAvailability();
  return c.json({ data: availability });
});

adminApi.get("/api/keys/:id/model-availability", (c) => {
  const keyId = c.req.param("id");
  const key = getKey(keyId);
  if (!key) return c.json({ error: "not found" }, 404);

  const unavailable = getUnavailableModels(keyId);
  return c.json({ data: unavailable });
});

adminApi.post("/api/keys/:id/reset-availability", (c) => {
  const keyId = c.req.param("id");
  const key = getKey(keyId);
  if (!key) return c.json({ error: "not found" }, 404);

  resetKeyAvailability(keyId);
  return c.json({ success: true });
});

// --- Health Checks ---

adminApi.get("/api/health-checks", (c) => {
  const limit = parseInt(c.req.query("limit") || "100", 10);
  const checks = getRecentHealthChecks(limit);
  return c.json({ data: checks });
});

adminApi.get("/api/health-checks/summary", (c) => {
  const summary = getHealthSummary();
  return c.json({ data: summary });
});

adminApi.post("/api/health-checks/run", async (c) => {
  try {
    const keyId = c.req.query("key_id");
    
    if (keyId) {
      // Run health check for specific key
      const result = await runHealthCheck(keyId);
      return c.json({ data: result });
    } else {
      // Run health check for all keys
      await runAllHealthChecks();
      return c.json({ success: true, message: "Health check cycle completed" });
    }
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// --- Providers & Pricing ---

adminApi.get("/api/providers", (c) => {
  return c.json({ data: PROVIDERS });
});

adminApi.get("/api/pricing", (c) => {
  return c.json({ data: listPricing() });
});

// --- Trial Farm ---

adminApi.get("/api/trials/radar", (c) => {
  return c.json({ data: getTrialRadar() });
});

adminApi.get("/api/trials/expiring", (c) => {
  const days = parseInt(c.req.query("days") || "7", 10);
  return c.json({ data: getExpiringTrials(days) });
});

adminApi.get("/api/trials/presets", (c) => {
  return c.json({ data: listPresetProviders() });
});

adminApi.post("/api/trials/reseed", (c) => {
  const keyId = c.req.query("key_id");
  if (keyId) {
    const key = getKey(keyId);
    if (!key) return c.json({ error: "not found" }, 404);
    const seeded = seedTrialsForKey(keyId, key.base_url);
    return c.json({ data: { keys_touched: seeded > 0 ? 1 : 0, rows_seeded: seeded } });
  }
  return c.json({ data: seedAllMissingTrials() });
});

adminApi.put("/api/trials/:keyId/:model", async (c) => {
  try {
    const { keyId, model } = c.req.param();
    const key = getKey(keyId);
    if (!key) return c.json({ error: "key not found" }, 404);

    const body = await c.req.json();
    const kind = body.kind === "calls" ? "calls" : "tokens";
    const limit = Number(body.limit_amount);
    if (!Number.isFinite(limit) || limit < 0) {
      return c.json({ error: "limit_amount must be a non-negative number" }, 400);
    }
    const quota = setTrialQuota(keyId, model, kind, limit, body.expires_at || null);
    return c.json({ data: quota });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminApi.delete("/api/trials/:keyId/:model", (c) => {
  const { keyId, model } = c.req.param();
  const deleted = deleteTrialQuota(keyId, model);
  if (!deleted) return c.json({ error: "not found" }, 404);
  return c.json({ success: true });
});

adminApi.get("/api/keys/:id/trials", (c) => {
  const keyId = c.req.param("id");
  const key = getKey(keyId);
  if (!key) return c.json({ error: "not found" }, 404);
  const quotas = getTrialRadar()
    .models.flatMap((m) => m.keys.filter((k) => k.key_id === keyId).map((k) => ({ ...k, model: m.model, kind: m.kind })));
  return c.json({ data: quotas });
});

// --- Key Farm sweep: validate every key + refresh trial rows ---

adminApi.post("/api/keys/sweep", async (c) => {
  const keys = listKeys();
  const report: Array<{ id: string; alias: string; ok: boolean; status: string; latency_ms: number; models: number; error?: string }> = [];
  let seeded = 0;

  for (const key of keys) {
    seeded += seedTrialsForKey(key.id, key.base_url);
    const withSecret = getKeyWithSecret(key.id);
    if (!withSecret) continue;

    const started = Date.now();
    try {
      const models = await adapter.listModels(withSecret, 10_000);
      updateKey(key.id, {
        status: "active",
        last_validated_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
        consecutive_failures: 0,
      });
      report.push({ id: key.id, alias: key.alias, ok: true, status: "active", latency_ms: Date.now() - started, models: models.length });
    } catch (err) {
      const error = err as any;
      updateKey(key.id, {
        status: error.classifiedStatus || "unknown",
        last_error_code: error.code || "unknown",
        last_error_message: error.message || String(err),
        last_validated_at: new Date().toISOString(),
      });
      report.push({ id: key.id, alias: key.alias, ok: false, status: error.classifiedStatus || "unknown", latency_ms: Date.now() - started, models: 0, error: error.message || String(err) });
    }
  }

  return c.json({
    data: {
      swept_at: new Date().toISOString(),
      keys_checked: report.length,
      keys_valid: report.filter((r) => r.ok).length,
      keys_failed: report.filter((r) => !r.ok).length,
      trials_seeded: seeded,
      keys: report,
    },
  });
});

// --- Client Keys (virtual sk-aliproxy-* keys) ---

adminApi.get("/api/client-keys", (c) => {
  return c.json({ data: listClientKeys() });
});

adminApi.post("/api/client-keys", async (c) => {
  try {
    const body = await c.req.json();
    if (!body.name) return c.json({ error: "name is required" }, 400);
    const { record, plaintext } = createClientKey({
      name: body.name,
      rpm_limit: body.rpm_limit ?? null,
      daily_request_limit: body.daily_request_limit ?? null,
      daily_token_budget: body.daily_token_budget ?? null,
      allowed_group_ids: Array.isArray(body.allowed_group_ids) ? body.allowed_group_ids : [],
    });
    return c.json({ data: { ...record, plaintext } }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminApi.get("/api/client-keys/:id", (c) => {
  const key = getClientKey(c.req.param("id"));
  if (!key) return c.json({ error: "not found" }, 404);
  return c.json({ data: { ...key, today_usage: getTodayUsage(key.id) } });
});

adminApi.put("/api/client-keys/:id", async (c) => {
  try {
    const key = updateClientKey(c.req.param("id"), await c.req.json());
    if (!key) return c.json({ error: "not found" }, 404);
    return c.json({ data: key });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

adminApi.delete("/api/client-keys/:id", (c) => {
  const deleted = deleteClientKey(c.req.param("id"));
  if (!deleted) return c.json({ error: "not found" }, 404);
  return c.json({ success: true });
});

adminApi.post("/api/client-keys/:id/rotate", (c) => {
  const rotated = rotateClientKey(c.req.param("id"));
  if (!rotated) return c.json({ error: "not found" }, 404);
  return c.json({ data: { ...rotated.record, plaintext: rotated.plaintext } });
});

// --- Usage & Savings ---

adminApi.get("/api/usage/summary", (c) => {
  const days = parseInt(c.req.query("days") || "30", 10);
  return c.json({ data: getUsageSummary(days) });
});

adminApi.get("/api/usage/daily", (c) => {
  const days = parseInt(c.req.query("days") || "30", 10);
  return c.json({ data: getUsageDaily(days) });
});

adminApi.get("/api/usage/savings", (c) => {
  return c.json({ data: getSavings() });
});

// --- Playground passthrough (admin-authed, same-origin) ---

adminApi.post("/api/proxy/chat/completions", async (c) => {
  const startTime = Date.now();
  try {
    const body = await c.req.json();
    if (!body.model || !Array.isArray(body.messages)) {
      return c.json({ error: "'model' and 'messages' are required" }, 400);
    }

    const result = await routeChatCompletions(body, null, {
      usageId: MASTER_USAGE_ID,
      allowedGroupIds: null,
    });

    const headers: Record<string, string> = { "X-Request-Id": result.requestId };
    if (result.groupId) headers["X-Aliproxy-Group"] = result.groupId;

    if (body.stream === true) {
      // Pass the stream through untouched (SSE)
      return new Response(result.response.body as any, {
        status: result.response.status,
        headers: { ...Object.fromEntries(result.response.headers.entries()), ...headers },
      });
    }

    const responseBody: any = await result.response.json();
    const latency = Date.now() - startTime;
    const tokens =
      (responseBody?.usage?.prompt_tokens ?? 0) + (responseBody?.usage?.completion_tokens ?? 0) || null;

    if (result.response.ok && result.keyId && result.upstreamModel && tokens) {
      consumeTrialTokens(result.keyId, result.upstreamModel, tokens);
    }

    logRequest({
      request_id: result.requestId,
      timestamp: new Date().toISOString(),
      client_ip: "playground",
      requested_model: body.model,
      resolved_group_id: result.groupId || null,
      upstream_model_id: result.upstreamModel || null,
      api_key_id: result.keyId || null,
      status_code: result.response.status,
      error_code: responseBody?.error?.code || null,
      latency_ms: latency,
      ttft_ms: null,
      prompt_tokens: responseBody?.usage?.prompt_tokens ?? null,
      completion_tokens: responseBody?.usage?.completion_tokens ?? null,
      streaming: false,
      retry_count: result.retryCount,
    });

    recordUsage({
      client_key_id: MASTER_USAGE_ID,
      group_id: result.groupId || null,
      model: result.upstreamModel || body.model,
      status_code: result.response.status,
      prompt_tokens: responseBody?.usage?.prompt_tokens ?? 0,
      completion_tokens: responseBody?.usage?.completion_tokens ?? 0,
    });

    return c.json(responseBody, result.response.status as any, headers);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// --- Intake folder (drop new trial keys here) ---

adminApi.get("/api/keys/intake/status", (c) => {
  return c.json({ data: getIntakeStatus() });
});

adminApi.post("/api/keys/intake/scan", async (c) => {
  const report = await scanIntakeDir();
  return c.json({ data: report });
});

// --- Studio passthroughs (admin-authed image/video generation) ---

adminApi.post("/api/proxy/images/generations", async (c) => {
  const startTime = Date.now();
  try {
    const body = await c.req.json();
    if (!body.model || !body.prompt) {
      return c.json({ error: "'model' and 'prompt' are required" }, 400);
    }

    const result = await routeImagesGenerations(body, "studio", {
      usageId: MASTER_USAGE_ID,
      allowedGroupIds: null,
    });
    const responseBody: any = await result.response.json().catch(() => null);
    const latency = Date.now() - startTime;

    logRequest({
      request_id: result.requestId,
      timestamp: new Date().toISOString(),
      client_ip: "studio",
      requested_model: body.model,
      resolved_group_id: result.groupId || null,
      upstream_model_id: result.upstreamModel || null,
      api_key_id: result.keyId || null,
      status_code: result.response.status,
      error_code: responseBody?.error?.code || (result.response.ok ? null : "upstream_error"),
      latency_ms: latency,
      ttft_ms: null,
      prompt_tokens: null,
      completion_tokens: null,
      streaming: false,
      retry_count: result.retryCount,
    });

    recordUsage({
      client_key_id: MASTER_USAGE_ID,
      group_id: result.groupId || null,
      model: result.upstreamModel || body.model,
      status_code: result.response.status,
      prompt_tokens: 0,
      completion_tokens: 0,
    });

    if (result.response.ok && result.keyId && result.upstreamModel) {
      consumeTrialCall(result.keyId, result.upstreamModel);
    }

    return c.json(
      responseBody ?? { error: { message: "upstream error", type: "upstream_error", code: "upstream_error" } },
      result.response.status as any,
      { "X-Request-Id": result.requestId, "X-Aliproxy-Upstream-Model": result.upstreamModel || "" },
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

adminApi.post("/api/proxy/videos/generations", async (c) => {
  const startTime = Date.now();
  try {
    const body = await c.req.json();
    if (!body.model || !body.input) {
      return c.json({ error: "'model' and 'input' are required" }, 400);
    }

    const result = await routeVideoSubmit(body, "studio", {
      usageId: MASTER_USAGE_ID,
      allowedGroupIds: null,
    });
    const responseBody: any = await result.response.json().catch(() => null);
    const latency = Date.now() - startTime;

    logRequest({
      request_id: result.requestId,
      timestamp: new Date().toISOString(),
      client_ip: "studio",
      requested_model: body.model,
      resolved_group_id: result.groupId || null,
      upstream_model_id: result.upstreamModel || null,
      api_key_id: result.keyId || null,
      status_code: result.response.status,
      error_code: responseBody?.output?.code || (result.response.ok ? null : "upstream_error"),
      latency_ms: latency,
      ttft_ms: null,
      prompt_tokens: null,
      completion_tokens: null,
      streaming: false,
      retry_count: result.retryCount,
    });

    recordUsage({
      client_key_id: MASTER_USAGE_ID,
      group_id: result.groupId || null,
      model: result.upstreamModel || body.model,
      status_code: result.response.status,
      prompt_tokens: 0,
      completion_tokens: 0,
    });

    if (result.response.ok && result.keyId && result.upstreamModel) {
      consumeTrialCall(result.keyId, result.upstreamModel);
    }

    return c.json(
      responseBody ?? { error: { message: "upstream error", type: "upstream_error", code: "upstream_error" } },
      result.response.status as any,
      { "X-Request-Id": result.requestId },
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

adminApi.get("/api/proxy/videos/generations/:taskId", async (c) => {
  try {
    const result = await routeVideoPoll(c.req.param("taskId"), "studio", {
      usageId: MASTER_USAGE_ID,
      allowedGroupIds: null,
    });
    const responseBody: any = await result.response.json().catch(() => null);
    return c.json(
      responseBody ?? { error: { message: "upstream error", type: "upstream_error", code: "upstream_error" } },
      result.response.status as any,
      { "X-Request-Id": result.requestId },
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// --- Groups backup / restore ---

adminApi.post("/api/groups/import", async (c) => {
  try {
    const body = await c.req.json();
    const incoming: any[] = Array.isArray(body) ? body : Array.isArray(body?.groups) ? body.groups : null;
    if (!incoming) {
      return c.json({ error: "Expected a JSON array of groups or { groups: [...] }" }, 400);
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const g of incoming) {
      if (!g?.id) {
        errors.push("group missing id — skipped");
        continue;
      }
      try {
        const existing = getGroup(g.id);
        if (existing) {
          updateGroup(g.id, {
            display_name: g.display_name ?? existing.display_name,
            aliases: g.aliases ?? existing.aliases,
            candidates: g.candidates ?? existing.candidates,
            strategy: g.strategy ?? existing.strategy,
            fallback_group_ids: g.fallback_group_ids ?? existing.fallback_group_ids,
            enabled: g.enabled ?? existing.enabled,
          });
          updated++;
        } else {
          createGroup(g);
          created++;
        }
      } catch (err: any) {
        errors.push(`${g.id}: ${err.message}`);
      }
    }

    return c.json({ data: { created, updated, errors, total: incoming.length } }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});
