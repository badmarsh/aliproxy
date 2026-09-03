import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash } from "node:crypto";
import { createLogger } from "./lib/logger.js";
import { config } from "./lib/config.js";
import { routeChatCompletions, routeEmbeddings } from "./lib/router.js";
import { listGroups } from "./lib/group-store.js";
import { listKeys } from "./lib/secret-store.js";
import { logRequest, getStats } from "./lib/request-log-store.js";

const log = createLogger("proxy-api");
export const proxyApi = new Hono();

proxyApi.use("*", cors());

// Client auth middleware
proxyApi.use("/v1/*", async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return c.json(
      { error: { message: "Missing Authorization header", type: "invalid_proxy_key", code: "invalid_proxy_key" } },
      401,
    );
  }

  const token = auth.slice(7);
  const hash = createHash("sha256").update(token).digest("hex");

  if (hash !== config.proxy.apiKeyHash) {
    return c.json(
      { error: { message: "Invalid proxy API key", type: "invalid_proxy_key", code: "invalid_proxy_key" } },
      401,
    );
  }

  await next();
});

// POST /v1/chat/completions
proxyApi.post("/v1/chat/completions", async (c) => {
  const startTime = Date.now();
  const clientIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || null;

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

    const result = await routeChatCompletions(body, clientIp);
    const latency = Date.now() - startTime;

    if (!result.response.ok) {
      const errorBody: any = await result.response.clone().json().catch(() => null);
      logRequest({
        request_id: result.requestId,
        timestamp: new Date().toISOString(),
        client_ip: clientIp,
        requested_model: body.model,
        resolved_group_id: result.groupId || null,
        upstream_model_id: result.upstreamModel || null,
        api_key_id: result.keyId || null,
        status_code: result.response.status,
        error_code: errorBody?.error?.code || null,
        latency_ms: latency,
        ttft_ms: null,
        prompt_tokens: null,
        completion_tokens: null,
        streaming: body.stream === true,
        retry_count: result.retryCount,
      });
    }

    const responseHeaders: Record<string, string> = {
      "X-Request-Id": result.requestId,
    };
    if (result.groupId) responseHeaders["X-Qwen-Proxy-Group"] = result.groupId;
    if (result.upstreamModel) responseHeaders["X-Qwen-Proxy-Upstream-Model"] = result.upstreamModel;
    if (result.retryCount > 0) responseHeaders["X-Qwen-Proxy-Retry-Count"] = String(result.retryCount);

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
        flush() {
          const totalLatency = Date.now() - startTime;
          logRequest({
            request_id: result.requestId,
            timestamp: new Date().toISOString(),
            client_ip: clientIp,
            requested_model: body.model,
            resolved_group_id: result.groupId || null,
            upstream_model_id: result.upstreamModel || null,
            api_key_id: result.keyId || null,
            status_code: result.response.status,
            error_code: null,
            latency_ms: totalLatency,
            ttft_ms: ttftMs,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            streaming: true,
            retry_count: result.retryCount,
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

    logRequest({
      request_id: result.requestId,
      timestamp: new Date().toISOString(),
      client_ip: clientIp,
      requested_model: body.model,
      resolved_group_id: result.groupId || null,
      upstream_model_id: result.upstreamModel || null,
      api_key_id: result.keyId || null,
      status_code: result.response.status,
      error_code: responseBody?.error?.code || null,
      latency_ms: latency,
      ttft_ms: null,
      prompt_tokens: responseBody?.usage?.prompt_tokens || null,
      completion_tokens: responseBody?.usage?.completion_tokens || null,
      streaming: false,
      retry_count: result.retryCount,
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

// POST /v1/embeddings
proxyApi.post("/v1/embeddings", async (c) => {
  const startTime = Date.now();
  const clientIp = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || null;

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

    const result = await routeEmbeddings(body, clientIp);
    const latency = Date.now() - startTime;

    if (!result.response.ok) {
      const errorBody: any = await result.response.json().catch(() => null);
      logRequest({
        request_id: result.requestId,
        timestamp: new Date().toISOString(),
        client_ip: clientIp,
        requested_model: body.model,
        resolved_group_id: result.groupId || null,
        upstream_model_id: result.upstreamModel || null,
        api_key_id: result.keyId || null,
        status_code: result.response.status,
        error_code: errorBody?.error?.code || "upstream_error",
        latency_ms: latency,
        ttft_ms: null,
        prompt_tokens: null,
        completion_tokens: null,
        streaming: false,
        retry_count: result.retryCount,
      });

      return c.json(errorBody || { error: "upstream error" }, result.response.status as any, {
        "X-Request-Id": result.requestId,
      });
    }

    const responseBody: any = await result.response.json();
    logRequest({
      request_id: result.requestId,
      timestamp: new Date().toISOString(),
      client_ip: clientIp,
      requested_model: body.model,
      resolved_group_id: result.groupId || null,
      upstream_model_id: result.upstreamModel || null,
      api_key_id: result.keyId || null,
      status_code: result.response.status,
      error_code: null,
      latency_ms: latency,
      ttft_ms: null,
      prompt_tokens: responseBody?.usage?.prompt_tokens || null,
      completion_tokens: null,
      streaming: false,
      retry_count: result.retryCount,
    });

    return c.json(responseBody, 200, {
      "X-Request-Id": result.requestId,
      "X-Qwen-Proxy-Group": result.groupId,
      "X-Qwen-Proxy-Upstream-Model": result.upstreamModel,
    });
  } catch (err) {
    log.error("Embeddings error", { error: (err as Error).message });
    return c.json(
      { error: { message: (err as Error).message, type: "server_error", code: "internal_error" } },
      500,
    );
  }
});

// GET /v1/models
proxyApi.get("/v1/models", (c) => {
  const groups = listGroups().filter((g) => g.enabled);

  const models = groups.map((g) => ({
    id: g.id,
    object: "model",
    created: Math.floor(new Date(g.created_at).getTime() / 1000),
    owned_by: "qwen-proxy",
  }));

  // Also include aliases
  for (const g of groups) {
    for (const alias of g.aliases) {
      models.push({
        id: alias,
        object: "model",
        created: Math.floor(new Date(g.created_at).getTime() / 1000),
        owned_by: "qwen-proxy",
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
    proxy_version: "0.1.0",
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

