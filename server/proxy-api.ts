import { Hono } from "hono";
import { cors } from "hono/cors";
import { createLogger } from "./lib/logger.js";
import { config } from "./lib/config.js";
import {
  routeChatCompletions,
  routeEmbeddings,
  routeImagesGenerations,
  routeVideoSubmit,
  routeVideoPoll,
} from "./lib/router.js";
import { listGroups } from "./lib/group-store.js";
import { listKeys } from "./lib/secret-store.js";
import { logRequest, getStats } from "./lib/request-log-store.js";
import { APP_VERSION } from "./lib/version.js";
import {
  authenticateClientKey,
  checkDailyLimits,
  recordUsage,
  CLIENT_KEY_PREFIX,
  MASTER_USAGE_ID,
  type ClientKey,
} from "./lib/client-key-store.js";
import { checkRateLimit } from "./lib/rate-limiter.js";
import { consumeTrialTokens, consumeTrialCall } from "./lib/trial-store.js";

const log = createLogger("proxy-api");
export const proxyApi = new Hono();

proxyApi.use("*", cors());

interface ProxyAuthInfo {
  usageId: string;
  clientKey: ClientKey | null;
}

/** Rough token estimate when the upstream returns no usage block. */
function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  return Math.max(1, Math.ceil(text.length / 4));
}

// ---------------------------------------------------------------------------
// Client auth — master key OR virtual client keys (sk-aliproxy-…)
// ---------------------------------------------------------------------------

proxyApi.use("/v1/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json(
      { error: { message: "Missing Authorization header", type: "invalid_proxy_key", code: "invalid_proxy_key" } },
      401,
    );
  }

  const token = auth.slice(7);
  let info: ProxyAuthInfo;

  if (token.startsWith(CLIENT_KEY_PREFIX)) {
    const clientKey = authenticateClientKey(token);
    if (!clientKey || !clientKey.enabled) {
      return c.json(
        { error: { message: "Invalid or disabled client key", type: "invalid_proxy_key", code: "invalid_client_key" } },
        401,
      );
    }

    // Sliding-window RPM limit
    const rl = checkRateLimit(`ck:${clientKey.id}`, clientKey.rpm_limit);
    if (!rl.allowed) {
      return c.json(
        { error: { message: `Rate limit exceeded (${rl.limit} req/min). Retry in ${rl.retry_after_seconds}s.`, type: "rate_limit_exceeded", code: "client_key_rate_limited" } },
        429,
        { "Retry-After": String(rl.retry_after_seconds) },
      );
    }

    // Daily request / token budgets
    const limits = checkDailyLimits(clientKey);
    if (!limits.ok) {
      return c.json(
        { error: { message: limits.message, type: "budget_exceeded", code: limits.code } },
        429,
      );
    }

    info = { usageId: clientKey.id, clientKey };
  } else {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(token).digest("hex");
    if (hash !== config.proxy.apiKeyHash) {
      return c.json(
        { error: { message: "Invalid proxy API key", type: "invalid_proxy_key", code: "invalid_proxy_key" } },
        401,
      );
    }
    info = { usageId: MASTER_USAGE_ID, clientKey: null };
  }

  (c as any).set("proxyAuth", info);
  await next();
});

function getAuth(c: any): ProxyAuthInfo {
  return (c.get("proxyAuth") as ProxyAuthInfo) || { usageId: MASTER_USAGE_ID, clientKey: null };
}

/** Shared post-routing bookkeeping: request log + usage rollup + trial meter. */
function meterRequest(opts: {
  auth: ProxyAuthInfo;
  clientIp: string | null;
  requestId: string;
  requestedModel: string;
  groupId: string | null;
  upstreamModel: string | null;
  keyId: string | null;
  statusCode: number;
  errorCode?: string | null;
  latencyMs: number;
  ttftMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  streaming: boolean;
  retryCount: number;
  isCallBased?: boolean;
}): void {
  logRequest({
    request_id: opts.requestId,
    timestamp: new Date().toISOString(),
    client_ip: opts.clientIp,
    requested_model: opts.requestedModel,
    resolved_group_id: opts.groupId,
    upstream_model_id: opts.upstreamModel,
    api_key_id: opts.keyId,
    status_code: opts.statusCode,
    error_code: opts.errorCode ?? null,
    latency_ms: opts.latencyMs,
    ttft_ms: opts.ttftMs ?? null,
    prompt_tokens: opts.promptTokens ?? null,
    completion_tokens: opts.completionTokens ?? null,
    streaming: opts.streaming,
    retry_count: opts.retryCount,
  });

  recordUsage({
    client_key_id: opts.auth.usageId,
    group_id: opts.groupId,
    model: opts.upstreamModel || opts.requestedModel,
    status_code: opts.statusCode,
    prompt_tokens: opts.promptTokens ?? 0,
    completion_tokens: opts.completionTokens ?? 0,
  });

  // Trial metering
  if (opts.keyId && opts.upstreamModel && opts.statusCode < 400) {
    if (opts.isCallBased) {
      consumeTrialCall(opts.keyId, opts.upstreamModel);
    } else {
      const tokens = (opts.promptTokens ?? 0) + (opts.completionTokens ?? 0);
      if (tokens > 0) consumeTrialTokens(opts.keyId, opts.upstreamModel, tokens);
    }
  }
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions
// ---------------------------------------------------------------------------

proxyApi.post("/v1/chat/completions", async (c) => {
  const startTime = Date.now();
  const clientIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || null;
  const auth = getAuth(c);

  try {
    const body = await c.req.json();

    if (!body.model) {
      return c.json(
        { error: { message: "'model' field is required", type: "invalid_request", code: "invalid_request" } },
        400,
      );
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json(
        { error: { message: "'messages' field is required and must be an array", type: "invalid_request", code: "invalid_request" } },
        400,
      );
    }

    const result = await routeChatCompletions(body, clientIp, {
      usageId: auth.usageId,
      allowedGroupIds: auth.clientKey?.allowed_group_ids?.length ? auth.clientKey.allowed_group_ids : null,
    });
    const latency = Date.now() - startTime;

    // Meter exactly once per request across all outcome paths
    let metered = false;
    const meterOnce = (opts: Parameters<typeof meterRequest>[0]) => {
      if (metered) return;
      metered = true;
      meterRequest(opts);
    };

    if (!result.response.ok) {
      const errorBody: any = await result.response.clone().json().catch(() => null);
      meterOnce({
        auth,
        clientIp,
        requestId: result.requestId,
        requestedModel: body.model,
        groupId: result.groupId || null,
        upstreamModel: result.upstreamModel || null,
        keyId: result.keyId || null,
        statusCode: result.response.status,
        errorCode: errorBody?.error?.code || null,
        latencyMs: latency,
        streaming: body.stream === true,
        retryCount: result.retryCount,
      });
    }

    const responseHeaders: Record<string, string> = {
      "X-Request-Id": result.requestId,
    };
    if (result.groupId) responseHeaders["X-Aliproxy-Group"] = result.groupId;
    if (result.upstreamModel) responseHeaders["X-Aliproxy-Upstream-Model"] = result.upstreamModel;
    if (result.retryCount > 0) responseHeaders["X-Aliproxy-Retry-Count"] = String(result.retryCount);

    if (body.stream === true && result.response.ok) {
      let ttftMs: number | null = null;
      let promptTokens: number | null = null;
      let completionTokens: number | null = null;
      const decoder = new TextDecoder();
      let streamBuffer = "";

      const transformStream = new TransformStream({
        transform(chunk: any, controller: any) {
          if (ttftMs === null) {
            ttftMs = Date.now() - startTime;
          }
          controller.enqueue(chunk);

          try {
            streamBuffer += decoder.decode(chunk, { stream: true });
            const lines = streamBuffer.split("\n");
            streamBuffer = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
                const jsonStr = trimmed.slice(6).trim();
                if (jsonStr.startsWith("{")) {
                  const parsed = JSON.parse(jsonStr);
                  if (parsed.usage) {
                    promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
                    completionTokens = parsed.usage.completion_tokens ?? completionTokens;
                  }
                }
              }
            }
          } catch {
            // Ignore parse errors for streaming usage extraction
          }
        },
        flush: () => {
          meterOnce({
            auth,
            clientIp,
            requestId: result.requestId,
            requestedModel: body.model,
            groupId: result.groupId || null,
            upstreamModel: result.upstreamModel || null,
            keyId: result.keyId || null,
            statusCode: result.response.status,
            latencyMs: Date.now() - startTime,
            ttftMs,
            promptTokens: promptTokens ?? estimateTokens(body.messages),
            completionTokens: completionTokens ?? 1,
            streaming: true,
            retryCount: result.retryCount,
          });
        },
      });

      const bodyStream = result.response.body ? (result.response.body as any).pipeThrough(transformStream) : null;

      return new Response(bodyStream as any, {
        status: result.response.status,
        headers: {
          ...Object.fromEntries(result.response.headers.entries()),
          ...responseHeaders,
        },
      });
    }

    if (body.stream === true) {
      return new Response(result.response.body as any, {
        status: result.response.status,
        headers: {
          ...Object.fromEntries(result.response.headers.entries()),
          ...responseHeaders,
        },
      });
    }

    const responseBody: any = await result.response.json();

    meterOnce({
      auth,
      clientIp,
      requestId: result.requestId,
      requestedModel: body.model,
      groupId: result.groupId || null,
      upstreamModel: result.upstreamModel || null,
      keyId: result.keyId || null,
      statusCode: result.response.status,
      errorCode: responseBody?.error?.code || null,
      latencyMs: latency,
      promptTokens: responseBody?.usage?.prompt_tokens ?? estimateTokens(body.messages),
      completionTokens: responseBody?.usage?.completion_tokens ?? 1,
      streaming: false,
      retryCount: result.retryCount,
    });

    return c.json(responseBody, result.response.status as any, responseHeaders);
  } catch (err) {
    log.error("Chat completions error", { error: (err as Error).message });
    return c.json(
      { error: { message: (err as Error).message, type: "server_error", code: "internal_error" } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /v1/embeddings
// ---------------------------------------------------------------------------

proxyApi.post("/v1/embeddings", async (c) => {
  const startTime = Date.now();
  const clientIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || null;
  const auth = getAuth(c);

  try {
    const body = await c.req.json();

    if (!body.model) {
      return c.json(
        { error: { message: "'model' field is required", type: "invalid_request", code: "invalid_request" } },
        400,
      );
    }

    if (!body.input) {
      return c.json(
        { error: { message: "'input' field is required", type: "invalid_request", code: "invalid_request" } },
        400,
      );
    }

    const result = await routeEmbeddings(body, clientIp, {
      usageId: auth.usageId,
      allowedGroupIds: auth.clientKey?.allowed_group_ids?.length ? auth.clientKey.allowed_group_ids : null,
    });
    const latency = Date.now() - startTime;

    const responseBody: any = await result.response.json().catch(() => null);

    meterRequest({
      auth,
      clientIp,
      requestId: result.requestId,
      requestedModel: body.model,
      groupId: result.groupId || null,
      upstreamModel: result.upstreamModel || null,
      keyId: result.keyId || null,
      statusCode: result.response.status,
      errorCode: responseBody?.error?.code || (result.response.ok ? null : "upstream_error"),
      latencyMs: latency,
      promptTokens: responseBody?.usage?.prompt_tokens ?? estimateTokens(body.input),
      completionTokens: 0,
      streaming: false,
      retryCount: result.retryCount,
    });

    if (!result.response.ok) {
      return c.json(responseBody || { error: "upstream error" }, result.response.status as any, {
        "X-Request-Id": result.requestId,
      });
    }

    return c.json(responseBody, 200, {
      "X-Request-Id": result.requestId,
      "X-Aliproxy-Group": result.groupId,
      "X-Aliproxy-Upstream-Model": result.upstreamModel,
    });
  } catch (err) {
    log.error("Embeddings error", { error: (err as Error).message });
    return c.json(
      { error: { message: (err as Error).message, type: "server_error", code: "internal_error" } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /v1/images/generations  (OpenAI shape; DashScope native translation inside)
// ---------------------------------------------------------------------------

proxyApi.post("/v1/images/generations", async (c) => {
  const startTime = Date.now();
  const clientIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || null;
  const auth = getAuth(c);

  try {
    const body = await c.req.json();
    if (!body.model) {
      return c.json({ error: { message: "'model' field is required", type: "invalid_request", code: "invalid_request" } }, 400);
    }
    if (!body.prompt || typeof body.prompt !== "string") {
      return c.json({ error: { message: "'prompt' field is required", type: "invalid_request", code: "invalid_request" } }, 400);
    }

    const result = await routeImagesGenerations(body, clientIp, {
      usageId: auth.usageId,
      allowedGroupIds: auth.clientKey?.allowed_group_ids?.length ? auth.clientKey.allowed_group_ids : null,
    });
    const latency = Date.now() - startTime;

    const responseBody: any = await result.response.json().catch(() => null);

    meterRequest({
      auth,
      clientIp,
      requestId: result.requestId,
      requestedModel: body.model,
      groupId: result.groupId || null,
      upstreamModel: result.upstreamModel || null,
      keyId: result.keyId || null,
      statusCode: result.response.status,
      errorCode: responseBody?.error?.code || (result.response.ok ? null : "upstream_error"),
      latencyMs: latency,
      promptTokens: 0,
      completionTokens: 0,
      streaming: false,
      retryCount: result.retryCount,
      isCallBased: true,
    });

    return c.json(responseBody ?? { error: { message: "upstream error", type: "upstream_error", code: "upstream_error" } }, result.response.status as any, {
      "X-Request-Id": result.requestId,
      "X-Aliproxy-Group": result.groupId,
      "X-Aliproxy-Upstream-Model": result.upstreamModel,
    });
  } catch (err) {
    log.error("Images error", { error: (err as Error).message });
    return c.json({ error: { message: (err as Error).message, type: "server_error", code: "internal_error" } }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /v1/videos/generations — async submit ({model, input, parameters})
// GET  /v1/videos/generations/:task_id — poll
// ---------------------------------------------------------------------------

proxyApi.post("/v1/videos/generations", async (c) => {
  const startTime = Date.now();
  const clientIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || null;
  const auth = getAuth(c);

  try {
    const body = await c.req.json();
    if (!body.model) {
      return c.json({ error: { message: "'model' field is required", type: "invalid_request", code: "invalid_request" } }, 400);
    }
    if (!body.input) {
      return c.json({ error: { message: "'input' field is required (e.g. {input: {prompt: \"...\"}})", type: "invalid_request", code: "invalid_request" } }, 400);
    }

    const result = await routeVideoSubmit(body, clientIp, {
      usageId: auth.usageId,
      allowedGroupIds: auth.clientKey?.allowed_group_ids?.length ? auth.clientKey.allowed_group_ids : null,
    });
    const latency = Date.now() - startTime;

    const responseBody: any = await result.response.json().catch(() => null);

    meterRequest({
      auth,
      clientIp,
      requestId: result.requestId,
      requestedModel: body.model,
      groupId: result.groupId || null,
      upstreamModel: result.upstreamModel || null,
      keyId: result.keyId || null,
      statusCode: result.response.status,
      errorCode: responseBody?.error?.code || responseBody?.output?.code || (result.response.ok ? null : "upstream_error"),
      latencyMs: latency,
      promptTokens: 0,
      completionTokens: 0,
      streaming: false,
      retryCount: result.retryCount,
      isCallBased: true,
    });

    return c.json(responseBody ?? { error: { message: "upstream error", type: "upstream_error", code: "upstream_error" } }, result.response.status as any, {
      "X-Request-Id": result.requestId,
      "X-Aliproxy-Group": result.groupId,
      "X-Aliproxy-Upstream-Model": result.upstreamModel,
    });
  } catch (err) {
    log.error("Video submit error", { error: (err as Error).message });
    return c.json({ error: { message: (err as Error).message, type: "server_error", code: "internal_error" } }, 500);
  }
});

proxyApi.get("/v1/videos/generations/:taskId", async (c) => {
  const auth = getAuth(c);
  const taskId = c.req.param("taskId");

  try {
    const result = await routeVideoPoll(taskId, null, {
      usageId: auth.usageId,
      allowedGroupIds: null,
    });
    const responseBody: any = await result.response.json().catch(() => null);
    return c.json(responseBody ?? { error: { message: "upstream error", type: "upstream_error", code: "upstream_error" } }, result.response.status as any, {
      "X-Request-Id": result.requestId,
    });
  } catch (err) {
    return c.json({ error: { message: (err as Error).message, type: "server_error", code: "internal_error" } }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /v1/models
// ---------------------------------------------------------------------------

proxyApi.get("/v1/models", (c) => {
  const groups = listGroups().filter((g) => g.enabled);

  const models = groups.map((g) => ({
    id: g.id,
    object: "model",
    created: Math.floor(new Date(g.created_at).getTime() / 1000),
    owned_by: "aliproxy",
  }));

  // Also include aliases
  for (const g of groups) {
    for (const alias of g.aliases) {
      models.push({
        id: alias,
        object: "model",
        created: Math.floor(new Date(g.created_at).getTime() / 1000),
        owned_by: "aliproxy",
      });
    }
  }

  return c.json({
    object: "list",
    data: models,
  });
});

// GET /health
proxyApi.get("/health", (c) => {
  return c.json({
    status: "ok",
    uptime_seconds: process.uptime(),
    proxy_version: APP_VERSION,
  });
});

// GET /ready
proxyApi.get("/ready", (c) => {
  const now = new Date();
  const groups = listGroups().filter((g) => g.enabled);
  const eligibleKeys = listKeys().filter(
    (k) =>
      k.enabled &&
      k.status !== "invalid" &&
      k.status !== "disabled" &&
      (!k.cooldown_until || new Date(k.cooldown_until) <= now),
  );

  const hasEligibleGroup = groups.some((g) =>
    g.key_ids.some((kid) => eligibleKeys.some((k) => k.id === kid)),
  );

  if (groups.length === 0) {
    return c.json(
      { status: "not_ready", reason: "No configured groups" },
      503,
    );
  }

  if (!hasEligibleGroup) {
    return c.json(
      { status: "not_ready", reason: "No group has an eligible key" },
      503,
    );
  }

  return c.json({
    status: "ok",
    groups: groups.length,
    eligible_keys: eligibleKeys.length,
  });
});

// GET /metrics
proxyApi.get("/metrics", (c) => {
  const stats = getStats();
  return c.json(stats);
});
