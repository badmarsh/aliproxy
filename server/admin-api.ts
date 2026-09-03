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
import { getRecentLogs, getStats, getTimeline } from "./lib/request-log-store.js";
import { adapter } from "./lib/dashscope-adapter.js";
import { detectKeyType, detectRegion, parseCsvKey } from "./lib/csv-parser.js";
import type { KeyType } from "./lib/types.js";
import { getAllModelAvailability, getUnavailableModels, resetKeyAvailability } from "./lib/model-availability-store.js";
import { recordHealthCheck, getRecentHealthChecks, getHealthSummary, purgeOldHealthChecks } from "./lib/health-check-store.js";
import { runHealthCheck, startHealthChecker, stopHealthChecker, runAllHealthChecks } from "./lib/health-checker.js";

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

    return c.json({ data: key }, 201);
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
    return c.json({ data: result }, 201);
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
  const logs = getRecentLogs(limit, groupId || undefined);
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
