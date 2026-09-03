import { createLogger } from "./logger.js";
import { resolveAliasOrGroup, listGroups as listGroupsAll } from "./group-store.js";
import { dispatchKey, markKeyCooldown, markKeyStatus, incrementKeyFailure } from "./dispatcher.js";
import { adapter } from "./dashscope-adapter.js";
import { logRequest } from "./request-log-store.js";
import { checkQuota, consumeQuota } from "./quota-guard.js";
import { generateRequestId } from "./ids.js";
import { config } from "./config.js";
import { isModelAvailable, markModelUnavailable, markModelAvailable } from "./model-availability-store.js";
import { burnTrial } from "./trial-store.js";
import { rememberTask, recallTask } from "./task-registry.js";
import { getKeyWithSecret, getKeysForDispatch } from "./secret-store.js";
import type { ModelGroup, ApiKeyWithSecret, NormalizedChatRequest, NormalizedEmbeddingRequest, ModelCapability } from "./types.js";

const log = createLogger("router");

/**
 * Who is calling the proxy: a virtual client key id, or the master key.
 * `allowedGroupIds === null` means unrestricted (master key).
 */
export interface ProxyAuthContext {
  usageId: string;
  allowedGroupIds: string[] | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt: number, baseMs: number = 500, maxMs: number = 5000): number {
  const delay = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * delay * 0.1; // ±10% jitter
  return Math.min(delay + jitter, maxMs);
}

export interface RouteResult {
  response: Response;
  requestId: string;
  groupId: string;
  upstreamModel: string;
  keyId: string;
  retryCount: number;
}

export async function routeChatCompletions(
  request: NormalizedChatRequest,
  clientIp: string | null,
  auth?: ProxyAuthContext,
): Promise<RouteResult> {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const requestedModel = request.model;
  const isStreaming = request.stream === true;

  const requiredCapabilities: ModelCapability[] = ["chat"];
  if (isStreaming) requiredCapabilities.push("streaming");
  if (hasVisionContent(request)) requiredCapabilities.push("vision");
  if (request.tools && request.tools.length > 0) requiredCapabilities.push("tools");

  const resolved = resolveRoute(requestedModel, requiredCapabilities, auth?.allowedGroupIds ?? null);
  const { group, upstreamModel, key } = resolved;

  if (resolved.forbidden) {
    return {
      response: createError(
        403,
        "group_not_allowed",
        `This client key is not allowed to access the group serving model '${requestedModel}'`,
      ),
      requestId,
      groupId: "",
      upstreamModel: "",
      keyId: "",
      retryCount: 0,
    };
  }

  if (!group || !upstreamModel || !key) {
    const latency = Date.now() - startTime;

    // Trial Farm: keys exist but every trial quota for the model is spent
    if (resolved.noKeyReason === "trial_exhausted") {
      logRequest({
        request_id: requestId,
        timestamp: new Date().toISOString(),
        client_ip: clientIp,
        requested_model: requestedModel,
        resolved_group_id: group?.id || null,
        upstream_model_id: upstreamModel || null,
        api_key_id: null,
        status_code: 503,
        error_code: "trial_exhausted",
        latency_ms: latency,
        ttft_ms: null,
        prompt_tokens: null,
        completion_tokens: null,
        streaming: isStreaming,
        retry_count: 0,
      });
      return {
        response: createError(
          503,
          "trial_exhausted",
          `All free-trial quotas for '${upstreamModel}' are exhausted. Add more trial keys (or attach a paid key) to keep serving '${requestedModel}'.`,
        ),
        requestId,
        groupId: group?.id || "",
        upstreamModel: upstreamModel || "",
        keyId: "",
        retryCount: 0,
      };
    }

    logRequest({
      request_id: requestId,
      timestamp: new Date().toISOString(),
      client_ip: clientIp,
      requested_model: requestedModel,
      resolved_group_id: null,
      upstream_model_id: null,
      api_key_id: null,
      status_code: 404,
      error_code: "model_not_found",
      latency_ms: latency,
      ttft_ms: null,
      prompt_tokens: null,
      completion_tokens: null,
      streaming: isStreaming,
      retry_count: 0,
    });

    return {
      response: createError(404, "model_not_found", `Model '${requestedModel}' not found`),
      requestId,
      groupId: "",
      upstreamModel: "",
      keyId: "",
      retryCount: 0,
    };
  }

  const forwardRequest = { ...request, model: upstreamModel };
  const maxRetries = Math.min(3, group.key_ids.length - 1);
  let retryCount = 0;
  let currentKey = key;
  let currentModel = upstreamModel;

  while (true) {
    try {
      const response = await adapter.chatCompletions(forwardRequest, currentKey);

      if (response.ok) {
        markKeyStatus(currentKey.id, "active");
        markModelAvailable(currentKey.id, currentModel);
        log.info("Request routed successfully", {
          requestId,
          groupId: group.id,
          upstreamModel: currentModel,
          keyId: currentKey.id,
          retryCount,
          latency: Date.now() - startTime,
        });

        return {
          response,
          requestId,
          groupId: group.id,
          upstreamModel: currentModel,
          keyId: currentKey.id,
          retryCount,
        };
      }

      const error = await adapter.parseError(response);
      log.warn("Upstream error", {
        requestId,
        keyId: currentKey.id,
        model: currentModel,
        status: error.status,
        code: error.code,
        retryCount,
        maxRetries,
      });

      // Per-key+model tracking: mark this specific combo unavailable for quota/access errors
      if (error.classifiedStatus === "quota_exhausted" || error.classifiedStatus === "disabled") {
        markModelUnavailable(currentKey.id, currentModel, error.code, error.message);
        // Trial Farm: an upstream "no quota left" on a tracked trial row burns it,
        // so dispatch stops picking this key for the model
        if (error.classifiedStatus === "quota_exhausted") {
          burnTrial(currentKey.id, currentModel);
        }
        // Key stays active — other models may still work
      } else if (error.classifiedStatus === "invalid") {
        // Invalid key = all models fail, mark whole key
        markKeyStatus(currentKey.id, "invalid", error.code, error.message);
      } else if (error.classifiedStatus === "rate_limited") {
        markKeyCooldown(currentKey.id, 10, error.code, error.message);
      } else {
        incrementKeyFailure(currentKey.id);
      }

      // For streaming, invalid key, or disabled key — return immediately (can't retry mid-stream)
      if (isStreaming || error.classifiedStatus === "invalid") {
        return {
          response: createError(
            error.status === 401 ? 502 : error.status === 404 ? 400 : error.status,
            "upstream_error",
            error.message,
          ),
          requestId,
          groupId: group.id,
          upstreamModel: currentModel,
          keyId: currentKey.id,
          retryCount,
        };
      }

      // For quota_exhausted or disabled model — try next candidate in group
      if (error.classifiedStatus === "quota_exhausted" || error.classifiedStatus === "disabled") {
        const nextCandidate = findNextAvailableCandidate(group, requiredCapabilities, currentKey.id, currentModel);
        if (nextCandidate) {
          log.info("Switching to next available candidate", {
            requestId,
            from: currentModel,
            to: nextCandidate.model,
            keyId: nextCandidate.key.id,
          });
          currentModel = nextCandidate.model;
          currentKey = nextCandidate.key;
          forwardRequest.model = currentModel;
          retryCount++;
          continue;
        }
      }

      if (retryCount >= maxRetries) {
        return tryFallbackGroups(
          group,
          forwardRequest,
          requiredCapabilities,
          requestId,
          clientIp,
          requestedModel,
          isStreaming,
          startTime,
          retryCount,
        );
      }

      retryCount++;
      const backoffMs = exponentialBackoff(retryCount - 1);
      log.info("Retrying with backoff", { requestId, retryCount, backoffMs: Math.round(backoffMs) });
      await sleep(backoffMs);

      const nextKey = dispatchKey(group.id, group.strategy, group.weights, currentModel);
      if (!nextKey) {
        return tryFallbackGroups(
          group,
          forwardRequest,
          requiredCapabilities,
          requestId,
          clientIp,
          requestedModel,
          isStreaming,
          startTime,
          retryCount,
        );
      }
      currentKey = nextKey;
    } catch (err) {
      log.error("Upstream request failed", {
        requestId,
        keyId: currentKey.id,
        error: (err as Error).message,
      });

      incrementKeyFailure(currentKey.id);

      if (retryCount >= maxRetries) {
        return tryFallbackGroups(
          group,
          forwardRequest,
          requiredCapabilities,
          requestId,
          clientIp,
          requestedModel,
          isStreaming,
          startTime,
          retryCount,
        );
      }

      retryCount++;
      const backoffMs = exponentialBackoff(retryCount - 1);
      log.info("Retrying with backoff", { requestId, retryCount, backoffMs: Math.round(backoffMs) });
      await sleep(backoffMs);

      const nextKey = dispatchKey(group.id, group.strategy, group.weights, currentModel);
      if (!nextKey) {
        return {
          response: createError(503, "no_upstream_available", "All upstream keys exhausted (trial quotas may be spent)"),
          requestId,
          groupId: group.id,
          upstreamModel: currentModel,
          keyId: currentKey.id,
          retryCount,
        };
      }
      currentKey = nextKey;
    }
  }
}

export async function routeEmbeddings(
  request: NormalizedEmbeddingRequest,
  clientIp: string | null,
  auth?: ProxyAuthContext,
): Promise<RouteResult> {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const requestedModel = request.model;

  const resolved = resolveRoute(requestedModel, ["embeddings"], auth?.allowedGroupIds ?? null);
  if (resolved.forbidden) {
    return {
      response: createError(403, "group_not_allowed", `This client key is not allowed to access the group serving model '${requestedModel}'`),
      requestId,
      groupId: "",
      upstreamModel: "",
      keyId: "",
      retryCount: 0,
    };
  }
  const { group, upstreamModel, key } = resolved;

  if (!group || !upstreamModel || !key) {
    return {
      response: createError(404, "model_not_found", `Embedding model '${requestedModel}' not found`),
      requestId,
      groupId: "",
      upstreamModel: "",
      keyId: "",
      retryCount: 0,
    };
  }

  const forwardRequest = { ...request, model: upstreamModel };

  try {
    const response = await adapter.embeddings(forwardRequest, key);

    if (response.ok) {
      markKeyStatus(key.id, "active");
      return {
        response,
        requestId,
        groupId: group.id,
        upstreamModel,
        keyId: key.id,
        retryCount: 0,
      };
    }

    const error = await adapter.parseError(response);
    if (error.classifiedStatus === "quota_exhausted") {
      markKeyStatus(key.id, "quota_exhausted", error.code, error.message);
    } else if (error.classifiedStatus === "invalid") {
      markKeyStatus(key.id, "invalid", error.code, error.message);
    }

    return {
      response: createError(502, "upstream_error", error.message),
      requestId,
      groupId: group.id,
      upstreamModel,
      keyId: key.id,
      retryCount: 0,
    };
  } catch (err) {
    incrementKeyFailure(key.id);
    return {
      response: createError(502, "upstream_error", (err as Error).message),
      requestId,
      groupId: group.id,
      upstreamModel,
      keyId: key.id,
      retryCount: 0,
    };
  }
}

interface ResolvedRoute {
  group: ModelGroup | null;
  upstreamModel: string | null;
  key: ApiKeyWithSecret | null;
  forbidden?: boolean;
  noKeyReason?: "no_eligible_keys" | "trial_exhausted";
}

function resolveRoute(
  modelId: string,
  requiredCapabilities: ModelCapability[],
  allowedGroupIds: string[] | null = null,
): ResolvedRoute {
  const group = resolveAliasOrGroup(modelId);

  if (!group) {
    if (config.routing.unknownModelPolicy === "default_group" && config.routing.defaultGroup) {
      const defaultGroup = resolveAliasOrGroup(config.routing.defaultGroup);
      if (defaultGroup) {
        if (allowedGroupIds && !allowedGroupIds.includes(defaultGroup.id)) {
          return { group: null, upstreamModel: null, key: null, forbidden: true };
        }
        return selectFromGroup(defaultGroup, requiredCapabilities);
      }
    }
    return { group: null, upstreamModel: null, key: null };
  }

  if (allowedGroupIds && !allowedGroupIds.includes(group.id)) {
    return { group: null, upstreamModel: null, key: null, forbidden: true };
  }

  return selectFromGroup(group, requiredCapabilities);
}

function selectFromGroup(
  group: ModelGroup,
  requiredCapabilities: ModelCapability[],
): ResolvedRoute {
  const candidates = group.candidates
    .filter((c) => {
      for (const cap of requiredCapabilities) {
        if (!c.capabilities.includes(cap)) return false;
      }
      return true;
    })
    .sort((a, b) => a.priority - b.priority);

  if (candidates.length === 0) {
    const fallback = group.candidates.sort((a, b) => a.priority - b.priority);
    if (fallback.length > 0) {
      const key = dispatchKey(group.id, group.strategy, group.weights, fallback[0].upstream_model_id);
      return { group, upstreamModel: fallback[0].upstream_model_id, key };
    }
    return { group, upstreamModel: null, key: null };
  }

  // Try candidates in priority order, skipping unavailable key+model combos
  for (const candidate of candidates) {
    const key = dispatchKey(group.id, group.strategy, group.weights, candidate.upstream_model_id);
    if (!key) continue;

    // Check if this key+model combo is available
    if (isModelAvailable(key.id, candidate.upstream_model_id)) {
      return { group, upstreamModel: candidate.upstream_model_id, key };
    }

    log.debug("Skipping unavailable key+model combo", {
      keyId: key.id,
      model: candidate.upstream_model_id,
      groupId: group.id,
    });
  }

  // All combos unavailable, return first candidate anyway (will fail and be logged)
  const key = dispatchKey(group.id, group.strategy, group.weights, candidates[0].upstream_model_id);
  const noKeyReason = key === null && getKeysForDispatch(group.id).length > 0 ? "trial_exhausted" : "no_eligible_keys";
  return { group, upstreamModel: candidates[0].upstream_model_id, key, noKeyReason };
}

async function tryFallbackGroups(
  primaryGroup: ModelGroup,
  request: any,
  requiredCapabilities: ModelCapability[],
  requestId: string,
  clientIp: string | null,
  requestedModel: string,
  isStreaming: boolean,
  startTime: number,
  retryCount: number,
): Promise<RouteResult> {
  for (const fallbackId of primaryGroup.fallback_group_ids) {
    const fallbackGroup = resolveAliasOrGroup(fallbackId);
    if (!fallbackGroup) continue;

    const { upstreamModel, key } = selectFromGroup(fallbackGroup, requiredCapabilities);
    if (!upstreamModel || !key) continue;

    log.info("Trying fallback group", {
      requestId,
      fallbackGroup: fallbackId,
      upstreamModel,
      keyId: key.id,
    });

    try {
      const response = await adapter.chatCompletions(
        { ...request, model: upstreamModel },
        key,
      );

      if (response.ok) {
        markKeyStatus(key.id, "active");
        return {
          response,
          requestId,
          groupId: fallbackGroup.id,
          upstreamModel,
          keyId: key.id,
          retryCount,
        };
      }
    } catch {
      incrementKeyFailure(key.id);
    }
  }

  return {
    response: createError(503, "no_upstream_available", "All upstream keys and fallbacks exhausted"),
    requestId,
    groupId: primaryGroup.id,
    upstreamModel: "",
    keyId: "",
    retryCount,
  };
}

function findNextAvailableCandidate(
  group: ModelGroup,
  requiredCapabilities: ModelCapability[],
  excludeKeyId: string,
  excludeModelId: string,
): { model: string; key: ApiKeyWithSecret } | null {
  const candidates = group.candidates
    .filter((c) => {
      if (c.upstream_model_id === excludeModelId) return false;
      for (const cap of requiredCapabilities) {
        if (!c.capabilities.includes(cap)) return false;
      }
      return true;
    })
    .sort((a, b) => a.priority - b.priority);

  for (const candidate of candidates) {
    const key = dispatchKey(group.id, group.strategy, group.weights, candidate.upstream_model_id);
    if (!key) continue;
    if (isModelAvailable(key.id, candidate.upstream_model_id)) {
      return { model: candidate.upstream_model_id, key };
    }
  }

  return null;
}

function hasVisionContent(request: NormalizedChatRequest): boolean {
  for (const msg of request.messages) {
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part === "object" && "type" in part && part.type === "image_url") {
          return true;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Multimodal routes (Trial Farm: image & video generation)
// ---------------------------------------------------------------------------

export async function routeImagesGenerations(
  request: { model: string; prompt: string; [key: string]: unknown },
  clientIp: string | null,
  auth?: ProxyAuthContext,
): Promise<RouteResult> {
  const requestId = generateRequestId();
  const resolved = resolveRoute(request.model, ["images"], auth?.allowedGroupIds ?? null);
  if (resolved.forbidden) {
    return {
      response: createError(403, "group_not_allowed", `This client key is not allowed to access the group serving model '${request.model}'`),
      requestId, groupId: "", upstreamModel: "", keyId: "", retryCount: 0,
    };
  }
  const { group, upstreamModel, key } = resolved;
  if (!group || !upstreamModel || !key) {
    return {
      response: createError(404, "model_not_found", `Image model '${request.model}' not found`),
      requestId, groupId: "", upstreamModel: "", keyId: "", retryCount: 0,
    };
  }

  try {
    const response = await adapter.imagesGenerations({ ...request, model: upstreamModel }, key);
    if (response.ok) markKeyStatus(key.id, "active");
    return { response, requestId, groupId: group.id, upstreamModel, keyId: key.id, retryCount: 0 };
  } catch (err) {
    log.error("Image generation failed", { requestId, keyId: key.id, error: (err as Error).message });
    incrementKeyFailure(key.id);
    return {
      response: createError(502, "upstream_error", (err as Error).message),
      requestId, groupId: group.id, upstreamModel, keyId: key.id, retryCount: 0,
    };
  }
}

export async function routeVideoSubmit(
  request: { model: string; input?: unknown; parameters?: unknown; [key: string]: unknown },
  clientIp: string | null,
  auth?: ProxyAuthContext,
): Promise<RouteResult> {
  const requestId = generateRequestId();
  const resolved = resolveRoute(request.model, ["video"], auth?.allowedGroupIds ?? null);
  if (resolved.forbidden) {
    return {
      response: createError(403, "group_not_allowed", `This client key is not allowed to access the group serving model '${request.model}'`),
      requestId, groupId: "", upstreamModel: "", keyId: "", retryCount: 0,
    };
  }
  const { group, upstreamModel, key } = resolved;
  if (!group || !upstreamModel || !key) {
    return {
      response: createError(404, "model_not_found", `Video model '${request.model}' not found`),
      requestId, groupId: "", upstreamModel: "", keyId: "", retryCount: 0,
    };
  }

  try {
    const response = await adapter.videoSubmit({ ...request, model: upstreamModel }, key);
    if (response.ok) {
      markKeyStatus(key.id, "active");
      // Remember which key owns the task so polls hit the right account
      const body: any = await response.clone().json().catch(() => null);
      const taskId = body?.output?.task_id || body?.id;
      if (taskId) rememberTask(String(taskId), key.id, upstreamModel);
    }
    return { response, requestId, groupId: group.id, upstreamModel, keyId: key.id, retryCount: 0 };
  } catch (err) {
    log.error("Video submit failed", { requestId, keyId: key.id, error: (err as Error).message });
    incrementKeyFailure(key.id);
    return {
      response: createError(502, "upstream_error", (err as Error).message),
      requestId, groupId: group.id, upstreamModel, keyId: key.id, retryCount: 0,
    };
  }
}

export async function routeVideoPoll(
  taskId: string,
  clientIp: string | null,
  auth?: ProxyAuthContext,
): Promise<{ response: Response; requestId: string; groupId: string; upstreamModel: string; keyId: string }> {
  const requestId = generateRequestId();
  const remembered = recallTask(taskId);
  let key: ApiKeyWithSecret | null = remembered ? getKeyWithSecret(remembered.keyId) : null;

  if (!key) {
    // Fallback: any enabled video-capable group's key
    for (const group of listGroupsAll().filter((g) => g.enabled)) {
      const candidate = group.candidates.find((c) => c.capabilities.includes("video"));
      if (candidate) {
        const picked = dispatchKey(group.id, group.strategy, group.weights, candidate.upstream_model_id);
        if (picked) {
          key = picked;
          break;
        }
      }
    }
  }

  if (!key) {
    return {
      response: createError(404, "task_not_found", `Unknown task '${taskId}' and no video-capable key available to poll with`),
      requestId, groupId: "", upstreamModel: remembered?.model || "", keyId: "",
    };
  }

  try {
    const response = await adapter.videoPoll(taskId, key);
    return { response, requestId, groupId: "", upstreamModel: remembered?.model || "", keyId: key.id };
  } catch (err) {
    return {
      response: createError(502, "upstream_error", (err as Error).message),
      requestId, groupId: "", upstreamModel: remembered?.model || "", keyId: key.id,
    };
  }
}

function createError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({
      error: { message, type: code, param: null, code },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}
