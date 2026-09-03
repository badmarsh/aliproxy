# DashScope Upstream Compatibility Report

> **Date:** 2026-09-03  
> **Key type tested:** Workspace-scoped (`sk-ws-H.*`)  
> **Region:** Singapore (`ap-southeast-1`)  
> **Working key:** `1128690` (workspace `ws-lk6r9226lvmvsazr`)

---

## Executive Summary

| Capability | Status | Notes |
|------------|--------|-------|
| **GET /models** | ✅ 200 | Returns 165 models |
| **POST /chat/completions (non-stream)** | ✅ 200 | qwen-turbo, qwen-max work |
| **POST /chat/completions (SSE stream)** | ✅ 200 | Proper SSE format, `[DONE]` marker |
| **Vision models** | ✅ 200 | qwen-vl-plus works with text+image_url |
| **Embeddings** | ✅ 200 | text-embedding-v3, v4 (1024 dims) |
| **Function calling (tools)** | ⚠️ 403 | Blocked by quota on qwen-plus |
| **Invalid model** | ✅ 404 | Proper `model_not_found` error |
| **Concurrent requests** | ✅ | 5 parallel requests succeeded |
| **Rate-limit headers** | ❌ | No `X-RateLimit-*` headers present |

---

## Key Format & Base URL

**Workspace-scoped keys** use format `sk-ws-H.<WORKSPACE_ID>.<SUFFIX>.<CERT>` with per-workspace hostnames:

```
https://ws-<workspace-id>.<region>.maas.aliyuncs.com
```

This differs from the spec's assumption of fixed regional base URLs (`dashscope.aliyuncs.com`, `dashscope-intl.aliyuncs.com`). The proxy must extract `workspace_id` and `region` from the key's CSV or derive them from the `apiHost` field.

### Regions observed
- **Singapore** (`ap-southeast-1`) — most keys, default for free tier
- **Beijing** (`cn-beijing`) — key 6427779 (expired/invalid in testing)
- **Virginia** (`us-east-1`) — not tested, no keys available

---

## Endpoint Compatibility

### GET /compatible-mode/v1/models

```http
GET {base_url}/compatible-mode/v1/models
Authorization: Bearer {api_key}
```

**Response:** 200 OK with 165 models. Sample IDs:
- `qwen-turbo`, `qwen-plus`, `qwen-max`
- `qwen3-coder-plus`, `qwen3-coder-flash`
- `qwen-vl-max`, `qwen-vl-plus`
- `qwen-omni-turbo`
- `qwen3.7-flash`, `qwen3.7-max`, `qwen3.8-max`
- `deepseek-v3.2`, `deepseek-v4-flash`, `deepseek-v4-pro`
- `text-embedding-v3`, `text-embedding-v4`
- `ZHIPU/GLM-5.3`, `kimi-k3`, `glm-5.2`

### POST /compatible-mode/v1/chat/completions

**Non-stream:** 200 OK with standard OpenAI response format:
```json
{
  "id": "chatcmpl-xxx",
  "model": "qwen-turbo",
  "choices": [{"message": {"role": "assistant", "content": "hello world"}}],
  "usage": {"prompt_tokens": 17, "completion_tokens": 2, "total_tokens": 19}
}
```

**SSE Streaming:** 200 OK with `text/event-stream`. Format:
```
data: {"choices":[{"delta":{"content":"hello"},"index":0,...}], "model":"qwen-turbo", "id":"chatcmpl-xxx"}
...
data: {"choices":[{"delta":{"content":""},"finish_reason":"stop",...}]}

data: [DONE]
```

- TTFT (time to first chunk): ~0ms
- Proper `[DONE]` terminator present
- `finish_reason` in final chunk

### POST /compatible-mode/v1/embeddings

**Status:** 200 OK for both `text-embedding-v3` and `text-embedding-v4`.  
**Dimensions:** 1024  
**Usage:** Returns `prompt_tokens` and `total_tokens`.

### Vision (Multimodal)

**Model:** `qwen-vl-plus`  
**Status:** 200 OK  
**Format:** Standard OpenAI vision format with `content` as array:
```json
{
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "What color is the sky?"},
      {"type": "image_url", "image_url": {"url": "https://..."}}
    ]
  }]
}
```

### Function Calling (Tools)

**Status:** ⚠️ 403 `insufficient_quota` on `qwen-plus`  
**Note:** Blocked by free quota exhaustion, not by API incompatibility. Expected to work with funded keys.

---

## Response Headers

Standard response headers observed:
```
content-type: application/json
x-request-id: <uuid>
x-dashscope-call-gateway: true
x-dashscope-finished: true
x-dashscope-timeout: 3600
x-envoy-upstream-service-time: <ms>
req-arrive-time: <timestamp>
req-cost-time: <ms>
resp-start-time: <timestamp>
```

**No `X-RateLimit-*` headers** (no `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`). Quota telemetry must come from:
1. Error responses (`insufficient_quota`)
2. DashScope console/API (if available)
3. Local request counting

---

## Error Codes & HTTP Statuses

| Status | Error Code | Meaning |
|--------|------------|---------|
| 200 | — | Success |
| 400 | `invalid_request_error` | Malformed request |
| 401 | `invalid_api_key` | Invalid or expired key |
| 403 | `insufficient_quota` | Free quota exhausted |
| 403 | `AccessDenied.Unpurchased` | Model not enabled for workspace |
| 404 | `model_not_found` | Model does not exist |
| 429 | — | Not observed (no rate-limit headers) |
| 500 | — | Not observed |

Error format:
```json
{
  "error": {
    "message": "...",
    "id": "<request-id>",
    "type": "insufficient_quota",
    "code": "insufficient_quota"
  }
}
```

---

## Model Availability (per key)

Not all models are available on all keys. Availability depends on:
1. **Workspace region** (Beijing vs Singapore)
2. **Free tier vs paid** — free tier keys have limited model access
3. **Model enablement** — some models require explicit opt-in

**Observed:**
- `qwen-turbo`, `qwen-max`: ✅ Available (free tier)
- `qwen-plus`, `qwen3-coder-plus`: ❌ 403 (quota exhausted or not enabled)
- `qwen-vl-plus`: ✅ Available (vision models may have separate quota)

---

## Implications for Proxy Implementation

### 1. Key Format Update

The spec assumes `sk-...` keys with fixed regional base URLs. Must update to support workspace-scoped keys:

```typescript
interface ApiKey {
  // ...
  key_type: "standard" | "coding_plan" | "workspace_scoped";
  workspace_id?: string;           // e.g., "ws-lk6r9226lvmvsazr"
  region: "cn-beijing" | "ap-southeast-1" | "us-east-1";
  base_url: string;                // derived from workspace_id + region
}
```

### 2. Quota Telemetry

Since `X-RateLimit-*` headers are absent, the proxy must:
1. Parse error codes (`insufficient_quota`) to mark keys exhausted
2. Optionally poll DashScope usage API (if available)
3. Use local request counting as fallback
4. Display `TelemetrySource` as `unknown` or `local_estimate` in UI

### 3. Error Classification

```typescript
function classifyError(status: number, errorCode: string): KeyStatus {
  if (status === 401) return "invalid";
  if (errorCode === "insufficient_quota") return "quota_exhausted";
  if (errorCode === "AccessDenied.Unpurchased") return "disabled";
  if (status === 429) return "rate_limited";
  return "active";
}
```

### 4. Model Discovery

The `/models` endpoint returns 165 models. The proxy should:
1. Store available models per key (for UI display)
2. Allow admin to select which models to expose via groups
3. Not assume all models are available on all keys

---

## Open Questions

1. **Coding Plan keys** (`sk-sp-...`) — not tested. Do they use a different base URL (`coding.dashscope.aliyuncs.com`)?
2. **Rate-limit headers** — do they appear on paid keys or after quota exhaustion?
3. **Virginia region** — no keys available to test
4. **DashScope usage API** — does `GET /api/v1/models/limits?model={id}` exist for workspace keys?
5. **Free tier limits** — what are the exact quotas for free tier models?

---

## Recommendations

1. **Default region:** Singapore (`ap-southeast-1`) — most keys, free tier available
2. **Default models:** `qwen-turbo`, `qwen-max` (free tier), `qwen-vl-plus` (vision)
3. **Quota strategy:** Treat `insufficient_quota` errors as signal; mark key exhausted and rotate
4. **Model routing:** Allow admin to configure per-group model lists (not all 165 models)
5. **Streaming:** Fully supported with proper SSE format and `[DONE]` marker

---

## Test Scripts

- `scripts/discovery.mjs` — Round 1: basic endpoint probing
- `scripts/discovery2.mjs` — Round 2: key scanning for active quota
- `scripts/discovery3.mjs` — Round 3: comprehensive tests (streaming, vision, embeddings, tools, concurrency)

All scripts use workspace-scoped keys from `keys/*.csv` files.
