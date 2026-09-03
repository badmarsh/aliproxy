/**
 * Upstream adapter — OpenAI-compatible forwarding with three modes:
 *
 *   1. Echo (built-in mock, base_url "echo://local") — synthetic responses,
 *      zero network. Perfect for testing the farm without real keys.
 *   2. DashScope native — translates OpenAI-style image requests to the
 *      async text2image / video-synthesis task APIs, and polls tasks.
 *   3. Generic passthrough — any OpenAI-compatible endpoint.
 */

import { createLogger } from "./logger.js";
import { config } from "./config.js";
import type { UpstreamError, KeyStatus, ApiKeyWithSecret } from "./types.js";

const log = createLogger("adapter");

const ECHO_PREFIX = "echo://";

function isEcho(key: ApiKeyWithSecret): boolean {
  return key.base_url.startsWith(ECHO_PREFIX);
}

function isDashScope(key: ApiKeyWithSecret): boolean {
  return key.base_url.includes("dashscope");
}

/** https://dashscope-intl.aliyuncs.com/compatible-mode/v1 → https://dashscope-intl.aliyuncs.com */
function dashScopeOrigin(key: ApiKeyWithSecret): string {
  return key.base_url.replace(/\/compatible-mode\/v1\/?$/, "").replace(/\/v1\/?$/, "");
}

// ---------------------------------------------------------------------------
// Echo mock responses
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function echoChatResponse(request: any, key: ApiKeyWithSecret): Response {
  const model = request.model || "echo";
  const lastUser = [...(request.messages || [])].reverse().find((m: any) => m.role === "user");
  const userText =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.map((p: any) => p.text || "").join(" ")
        : "";
  const reply =
    `🔊 Aliproxy Echo (${model}) via key "${key.alias}"\n\n` +
    `You said: "${userText.slice(0, 2000)}"\n\n` +
    `This is a synthetic mock completion — your request was routed, logged, and metered ` +
    `exactly like a real one. Point your group candidates at a real provider when you're ready.`;

  const promptTokens = estimateTokens(JSON.stringify(request.messages || []));
  const completionTokens = estimateTokens(reply);
  const body = {
    id: `echo-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: reply },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function echoChatStream(request: any, key: ApiKeyWithSecret): Response {
  const model = request.model || "echo";
  const lastUser = [...(request.messages || [])].reverse().find((m: any) => m.role === "user");
  const userText = typeof lastUser?.content === "string" ? lastUser.content : "…";
  const chunks = [
    `🔊 Aliproxy Echo (${model}) via key "${key.alias}"\n\n`,
    `You said: "${userText.slice(0, 500)}"\n\n`,
    `Streaming works too — routed, logged, and metered like production traffic.`,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const created = Math.floor(Date.now() / 1000);
      let completionTokens = 0;
      for (let i = 0; i < chunks.length; i++) {
        completionTokens += estimateTokens(chunks[i]);
        const payload = {
          id: `echo-${Date.now()}`,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: chunks[i] }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        await new Promise((r) => setTimeout(r, 40));
      }
      const done = {
        id: `echo-${Date.now()}`,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: {
          prompt_tokens: estimateTokens(JSON.stringify(request.messages || [])),
          completion_tokens: completionTokens,
          total_tokens: completionTokens + 32,
        },
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(done)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function svgImage(prompt: string): string {
  const safe = (prompt || "aliproxy").slice(0, 80).replace(/[<>&"]/g, "");
  const colors = ["#0f172a", "#0891b2", "#22d3ee", "#a855f7", "#f97316"];
  let rects = "";
  for (let i = 0; i < 5; i++) {
    rects += `<rect x="${(i * 197) % 900}" y="${(i * 83) % 900}" width="${120 + i * 60}" height="${90 + i * 40}" fill="${colors[i % colors.length]}" opacity="0.7" rx="16"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">${rects}<text x="32" y="980" font-family="monospace" font-size="28" fill="#e2e8f0">aliproxy echo · ${safe}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function echoImagesResponse(request: any): Response {
  const n = Math.min(Math.max(request.n || 1, 1), 4);
  const data = Array.from({ length: n }, () => ({ b64_json: svgImage(request.prompt).split(",")[1], revised_prompt: `echo: ${request.prompt}` }));
  return new Response(
    JSON.stringify({ created: Math.floor(Date.now() / 1000), data }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

export class DashScopeAdapter {
  async listModels(
    key: ApiKeyWithSecret,
    timeoutMs: number = config.proxy.requestTimeoutSeconds * 1000,
  ): Promise<{ id: string; object: string }[]> {
    if (isEcho(key)) {
      return [
        "echo-chat",
        "echo-chat-pro",
        "echo-vision",
        "echo-embed",
        "echo-image",
        "echo-video",
      ].map((id) => ({ id, object: "model" }));
    }

    const url = `${key.base_url}/models`;
    return fetchWithTimeout(url, { method: "GET", headers: { Authorization: `Bearer ${key.secret}` } }, timeoutMs, async (response) => {
      const data = (await response.json()) as any;
      return data.data || [];
    });
  }

  async chatCompletions(
    request: any,
    key: ApiKeyWithSecret,
    timeoutMs: number = config.proxy.requestTimeoutSeconds * 1000,
  ): Promise<Response> {
    if (isEcho(key)) {
      return request.stream === true ? echoChatStream(request, key) : echoChatResponse(request, key);
    }

    const url = `${key.base_url}/chat/completions`;
    log.debug("Forwarding chat completions", { key_id: key.id, model: request.model, stream: request.stream, url });

    return fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
      timeoutMs,
      async (r) => r,
    );
  }

  async embeddings(
    request: any,
    key: ApiKeyWithSecret,
    timeoutMs: number = config.proxy.requestTimeoutSeconds * 1000,
  ): Promise<Response> {
    if (isEcho(key)) {
      const inputs = Array.isArray(request.input) ? request.input : [request.input];
      const data = inputs.map((_: any, i: number) => ({
        object: "embedding",
        index: i,
        embedding: Array.from({ length: 8 }, (_, d) => Math.round(Math.sin(i + d + Date.now() % 7) * 1000) / 1000),
      }));
      const promptTokens = inputs.reduce((s: number, t: any) => s + estimateTokens(String(t)), 0);
      return new Response(
        JSON.stringify({ object: "list", data, model: request.model, usage: { prompt_tokens: promptTokens, total_tokens: promptTokens } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = `${key.base_url}/embeddings`;
    return fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
      timeoutMs,
      async (r) => r,
    );
  }

  /**
   * Image generation, OpenAI request shape ({model, prompt, n, size}).
   * DashScope keys are translated to the native async text2image API and
   * polled to completion; other providers get a passthrough.
   */
  async imagesGenerations(
    request: any,
    key: ApiKeyWithSecret,
    timeoutMs: number = config.proxy.requestTimeoutSeconds * 1000,
  ): Promise<Response> {
    if (isEcho(key)) return echoImagesResponse(request);

    if (isDashScope(key)) {
      const origin = dashScopeOrigin(key);
      const size = parseSize(request.size, "1024*1024");
      const submit = await fetchWithTimeout(
        `${origin}/api/v1/services/aigc/text2image/image-synthesis`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key.secret}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify({
            model: request.model,
            input: { prompt: request.prompt, negative_prompt: request.negative_prompt || undefined },
            parameters: { size, n: Math.min(request.n || 1, 4) },
          }),
        },
        Math.min(timeoutMs, 30_000),
        async (r) => r,
      );
      if (!submit.ok) return submit;

      const submitted = (await submit.json()) as any;
      const taskId = submitted?.output?.task_id;
      if (!taskId) {
        return new Response(JSON.stringify({ error: { message: "Upstream did not return a task_id", type: "upstream_error", code: "upstream_error" } }), { status: 502, headers: { "Content-Type": "application/json" } });
      }

      // Poll until done (or timeout)
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const poll = await fetch(`${origin}/api/v1/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${key.secret}` },
        });
        const body: any = await poll.json().catch(() => null);
        const status = body?.output?.task_status;
        if (status === "SUCCEEDED") {
          return new Response(
            JSON.stringify({
              created: Math.floor(Date.now() / 1000),
              data: (body.output.results || []).map((r: any) => ({ url: r.url, b64_json: r.b64_image || undefined })),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
          return new Response(
            JSON.stringify({ error: { message: body?.output?.message || `Task ${status}`, type: "upstream_error", code: `task_${status.toLowerCase()}` } }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
      }
      return new Response(JSON.stringify({ error: { message: "Image task timed out", type: "upstream_timeout", code: "upstream_timeout" } }), { status: 504, headers: { "Content-Type": "application/json" } });
    }

    return fetchWithTimeout(
      `${key.base_url}/images/generations`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
      timeoutMs,
      async (r) => r,
    );
  }

  /**
   * Video generation — async by nature: returns the upstream task payload
   * ({output: {task_id, task_status}} for DashScope).
   * Request body: {model, input: {prompt, ...}, parameters: {...}}
   */
  async videoSubmit(
    request: any,
    key: ApiKeyWithSecret,
    timeoutMs: number = Math.min(config.proxy.requestTimeoutSeconds * 1000, 60_000),
  ): Promise<Response> {
    if (isEcho(key)) {
      const taskId = `echo-task-${Date.now().toString(36)}`;
      this.echoTasks.set(taskId, Date.now());
      return new Response(
        JSON.stringify({ output: { task_id: taskId, task_status: "PENDING" }, request_id: taskId }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (isDashScope(key)) {
      const origin = dashScopeOrigin(key);
      return fetchWithTimeout(
        `${origin}/api/v1/services/aigc/video-generation/video-synthesis`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key.secret}`,
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
          },
          body: JSON.stringify(request),
        },
        timeoutMs,
        async (r) => r,
      );
    }

    return fetchWithTimeout(
      `${key.base_url}/videos/generations`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
      timeoutMs,
      async (r) => r,
    );
  }

  private echoTasks = new Map<string, number>();

  /** Poll an async generation task. */
  async videoPoll(taskId: string, key: ApiKeyWithSecret): Promise<Response> {
    if (isEcho(key)) {
      const started = this.echoTasks.get(taskId);
      const elapsed = started ? Date.now() - started : Infinity;
      if (taskId.startsWith("echo-task-") && elapsed > 3000) {
        return new Response(
          JSON.stringify({
            output: {
              task_id: taskId,
              task_status: "SUCCEEDED",
              video_url: `https://echo.aliproxy.local/video/${taskId}.mp4`,
            },
            usage: { video_count: 1 },
            request_id: taskId,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ output: { task_id: taskId, task_status: "PENDING" }, request_id: taskId }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (isDashScope(key)) {
      const origin = dashScopeOrigin(key);
      return fetchWithTimeout(
        `${origin}/api/v1/tasks/${taskId}`,
        { method: "GET", headers: { Authorization: `Bearer ${key.secret}` } },
        15_000,
        async (r) => r,
      );
    }

    return fetchWithTimeout(
      `${key.base_url}/videos/generations/${taskId}`,
      { method: "GET", headers: { Authorization: `Bearer ${key.secret}` } },
      15_000,
      async (r) => r,
    );
  }

  classifyError(status: number, errorCode: string, errorMessage?: string): UpstreamError {
    let classifiedStatus: KeyStatus = "active";

    if (status === 401 || errorCode === "invalid_api_key") {
      classifiedStatus = "invalid";
    } else if (errorCode === "insufficient_quota") {
      classifiedStatus = "quota_exhausted";
    } else if (errorCode === "AccessDenied.Unpurchased") {
      classifiedStatus = "disabled";
    } else if (status === 429) {
      if (errorMessage?.includes("quota") || errorMessage?.includes("exceeded")) {
        classifiedStatus = "quota_exhausted";
      } else {
        classifiedStatus = "rate_limited";
      }
    } else if (status === 403) {
      // Free-trial key that never purchased the model
      classifiedStatus = "disabled";
    }

    return { status, code: errorCode, message: errorMessage || "", classifiedStatus };
  }

  readRateLimitHints(response: Response) {
    const headers = response.headers;
    const rpmLimit = headers.get("x-ratelimit-limit-requests");
    const rpmRemaining = headers.get("x-ratelimit-remaining-requests");
    const rpmReset = headers.get("x-ratelimit-reset-requests");

    if (!rpmLimit && !rpmRemaining) return null;

    return {
      rpmLimit: rpmLimit ? parseInt(rpmLimit, 10) : null,
      rpmRemaining: rpmRemaining ? parseInt(rpmRemaining, 10) : null,
      rpmReset: rpmReset ? parseInt(rpmReset, 10) : null,
    };
  }

  async parseError(response: Response): Promise<UpstreamError> {
    try {
      const body = (await response.json()) as any;
      const error = body.error || body.output || {};
      return this.classifyError(
        response.status,
        error.code || error.error_code || error.type || "unknown",
        error.message || error.err_message || response.statusText,
      );
    } catch {
      return {
        status: response.status,
        code: "unknown",
        message: response.statusText,
        classifiedStatus: response.status === 401 ? "invalid" : "unknown",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSize(size: string | undefined, fallback: string): string {
  if (!size) return fallback;
  const m = size.match(/^(\d+)x(\d+)$/);
  return m ? `${m[1]}*${m[2]}` : fallback;
}

async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  extract: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const error = await new DashScopeAdapter().parseError(response);
      throw error;
    }
    return await extract(response);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw {
        status: 504,
        code: "upstream_timeout",
        message: `Upstream request timed out after ${timeoutMs}ms`,
        classifiedStatus: "rate_limited" as KeyStatus,
      };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const adapter = new DashScopeAdapter();
