# Changelog

Calendar versioning since 2026 (`<year>.<release>.<patch>`). Highlights only; see git history for detail.

---

## 2026.4.0 — “Trial Farm” (2026-09-03)

The free-trial-key-hoarder release.

- **Multimodal endpoints**: `/v1/images/generations` (OpenAI shape, auto-translated to
  DashScope native async text2image + poll) and `/v1/videos/generations` (async submit +
  poll, task→key registry so polls hit the right account).
- **Key farm sweep** (`POST /api/keys/sweep`): validate every key, mark dead ones, reseed
  trial rows — one button in the dashboard.
- **Dashboard Playground**: chat against any group with live streaming, same-origin via
  admin-authed passthrough.
- **Echo provider** (`echo://local`): built-in mock upstream for chat/stream/embeddings/
  images/video — the whole suite runs with zero real keys (`npm run proxy:seed-farm`).
- **Single-origin dashboard**: Next.js rewrites `/api/*` to the server; no more CORS or
  localhost cross-calls from the browser.
- All mock pages replaced with live data; new app shell + navigation.
- Error-classification improvement: 403 upstream now maps to `disabled` (unpurchased model
  on trial keys).

## 2026.3.0 (2026-06)

- **Trial quotas**: per key × model free-quota rows (tokens or calls), auto-seeded from
  provider presets, manually overridable.
- **Quota Radar**: model × key matrix, aggregate free-tokens/calls remaining,
  expiring-soon warnings (“burn these first”).
- **Exhaustion-aware dispatch**: keys with spent trials are skipped; `first_available`
  orders by soonest expiry; all-spent → `503 trial_exhausted` (fails closed rather than
  burning paid quota). Upstream quota errors burn the matching trial row.

## 2026.2.0 (2026-04)

- **Virtual client keys**: issue `sk-aliproxy-*` keys (SHA-256 hashed at rest, one-time
  plaintext reveal, instant rotation) with sliding-window RPM limits, daily request/token
  budgets, and group allowlists.
- **Usage analytics**: daily rollups (`usage_daily`), per-model/group/consumer breakdowns.
- **Savings meter**: pricing catalog (Qwen, OpenAI, Anthropic, DeepSeek, Gemini, Llama,
  Mistral et al.) × metered tokens = estimated spend avoided.

## 2026.1.0 (2026-02)

- Rebrand: Qwen Proxy Dashboard → **Aliproxy 2026 — Ultimate Proxy Suite**; CalVer.
- **Multi-provider presets**: DashScope intl/cn, OpenAI, DeepSeek, OpenRouter, Groq,
  Mistral, Ollama, vLLM — any OpenAI-compatible upstream.
- Version/identity centralized (`server/lib/version.ts`); DB default → `aliproxy.db`.

## 0.3.0 (2025-11)

- Per-model quota tracking, automated health checks (every 3h), curated custom groups
  (qwen-max/plus/coder/flash with dated snapshot priorities).
- CSV/text key import, model-availability store, readiness endpoint.

## 0.2.0 (2025-06)

- Real proxy server (Hono): `/v1/chat/completions` with streaming + TTFT capture,
  `/v1/embeddings`, `/v1/models`; round-robin/weighted/LRU/first-available dispatch;
  retry with exponential backoff, circuit breaker, cooldowns; AES-256-GCM secret store;
  SQLite migrations; admin API; live dashboard tabs.

## 0.1.0 (2025-03)

- First spike: Next.js dashboard shell, shadcn/ui components, Vercel-monochrome theme,
  mock data everywhere.
