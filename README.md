# Aliproxy 2026 — Ultimate Proxy Suite

**Version 2026.4.0 · “Trial Farm” edition** *(successor of AliProxy v0.3 / Qwen Proxy Dashboard)*

A local gateway + dashboard for people who collect **free-trial API keys**. DashScope hands
every fresh account ~1M tokens per model — plus trials for image and video models. Aliproxy
pools all of those keys behind one OpenAI-compatible endpoint, drains the free quota in the
smartest order, and shows you exactly how much money you avoided spending.

```
$ curl -s localhost:8080/api/usage/savings
{"free_tokens": 16000146, "estimated_spend_avoided_usd": 23.84, ...}
```

## What's in the suite

| Area | Features |
|---|---|
| **Trial Farm** | Per-key × per-model free-quota tracking (tokens *and* image/video calls), auto-seeded from provider presets, decremented as traffic flows |
| **Quota Radar** | Model × key matrix of remaining free quota; “expiring soon” alerts so you burn dying trials first |
| **Smart routing** | Exhaustion-aware dispatch — skips keys whose trial for that model is spent; `first_available` prefers soonest-expiring quota; fails closed with `503 trial_exhausted` instead of silently burning paid quota |
| **Multimodal** | `/v1/chat/completions` (sync + streaming), `/v1/embeddings`, `/v1/images/generations` (OpenAI shape; auto-translated to DashScope native text2image), `/v1/videos/generations` (async submit + poll) |
| **Client keys** | Issue your own `sk-aliproxy-…` keys with RPM limits, daily request/token budgets, and group allowlists — share the farm without sharing the master key |
| **Savings meter** | Per-model pricing catalog × metered usage = estimated spend avoided, daily rollups, per-model/group/consumer breakdowns |
| **Key farm tools** | Bulk import (JSON/CSV/text), one-click sweep (validate all keys + reseed trials), provider presets for DashScope (intl/cn), OpenAI, DeepSeek, OpenRouter, Groq, Mistral, Ollama, vLLM |
| **Echo provider** | Built-in mock upstream (`echo://local`) — the entire suite works with zero real keys |
| **Dashboard** | Next.js 14 app: Overview, Groups, Quota Radar, Client Keys, Usage & Savings, Playground, Metrics, Settings — all live, single-origin |

## Quickstart

```bash
npm install

# 1. start the proxy server (SQLite at ./data/aliproxy.db, migrations auto-run)
npm run proxy

# 2. in a second terminal — seed the Echo demo (key + 4 groups, works offline)
npm run proxy:seed-farm

# 3. start the dashboard
npm run dev            # → http://localhost:3456
```

`ENCRYPTION_KEY` is required for key storage — generate one into `.env`:

```bash
grep -q ENCRYPTION_KEY .env 2>/dev/null || echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

### Use it

```bash
# chat (streaming works)
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer aliproxy-local-key" \
  -d '{"model":"aliproxy-demo","messages":[{"role":"user","content":"hi"}]}'

# image generation — free wanx trials, OpenAI-compatible shape
curl http://127.0.0.1:8080/v1/images/generations \
  -H "Authorization: Bearer aliproxy-local-key" \
  -d '{"model":"wanx2.1-t2i-turbo","prompt":"a cat astronaut"}'

# video generation — async submit, then poll
curl -X POST http://127.0.0.1:8080/v1/videos/generations \
  -H "Authorization: Bearer aliproxy-local-key" \
  -d '{"model":"wan2.1-t2v-turbo","input":{"prompt":"a cat astronaut"}}'
curl http://127.0.0.1:8080/v1/videos/generations/{task_id} -H "Authorization: Bearer aliproxy-local-key"
```

Point any OpenAI SDK at `base_url="http://127.0.0.1:8080/v1"` and go.

## The hoarding loop

1. **Add trial keys** — Dashboard → Overview → *Add New Key* (pick a provider preset; trials seed automatically), or bulk-import a CSV of harvested keys
2. **Sweep** — validates every key, marks dead ones, tops up trial rows
3. **Watch the Quota Radar** — every model × key cell with remaining free quota and expiry
4. **Route** — groups map client-facing model names to upstream candidates; dispatch skips exhausted trials automatically
5. **Share safely** — issue `sk-aliproxy-*` client keys with daily budgets so apps (or friends) can't drain the farm

Full guide: [`docs/TRIAL-FARM.md`](docs/TRIAL-FARM.md).

## Architecture

```
Client (OpenAI SDK / curl / dashboard Playground)
  │  Bearer sk-aliproxy-… or master key
  ▼
Aliproxy server (Hono, :8080)
  ├─ /v1/chat/completions · /v1/embeddings · /v1/images/generations · /v1/videos/generations
  │    └─ auth → rate limit → daily budget → group allowlist → router
  │         └─ trial-aware dispatch → upstream adapter → meter (logs · usage · trials)
  ├─ /api/*  admin API (keys, groups, client-keys, trials, usage, sweep, playground)
  └─ SQLite (WAL): api_keys · model_groups · client_keys · trial_quotas · usage_daily · request_logs · …

Dashboard (Next.js 14, :3456) — rewrites /api/* to the server, single-origin
```

| Layer | Technology |
|---|---|
| Proxy server | Hono 4 + @hono/node-server, TypeScript |
| Storage | SQLite (better-sqlite3), AES-256-GCM (scrypt-derived) secret encryption |
| Dashboard | Next.js 14 App Router, shadcn/ui, Tailwind, Recharts |
| Tests | Vitest — 46 tests across stores, dispatch, auth, budgets, multimodal, analytics |

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `ENCRYPTION_KEY` | — *(required)* | Master passphrase for secret encryption |
| `PROXY_PORT` / `PROXY_HOST` | `8080` / `127.0.0.1` | Proxy listen address |
| `PROXY_API_KEY` | `aliproxy-local-key` | Master key for `/v1` + `/api` |
| `DATABASE_PATH` | `./data/aliproxy.db` | SQLite location |
| `REQUEST_TIMEOUT_SECONDS` / `STREAM_IDLE_TIMEOUT_SECONDS` | `120` / `60` | Timeouts |
| `DEFAULT_REGION` | `ap-southeast-1` | Default DashScope region |
| `UNKNOWN_MODEL_POLICY` | `reject` | `reject` or `default_group` (+ `DEFAULT_GROUP`) |
| `TRIAL_PRESETS_PATH` | — | JSON override for free-trial presets |
| `PRICING_FALLBACK_PROMPT` / `PRICING_FALLBACK_COMPLETION` | `0.5` / `1.5` | USD per 1M tokens for uncatalogued models |

> Trial preset amounts are *estimates* of each provider's current promotion (they change
> often). Correct any cell from the dashboard or via `PUT /api/trials/:keyId/:model`.

### Upgrading from v0.3 (Qwen Proxy Dashboard)

- Database default moved to `./data/aliproxy.db` — set `DATABASE_PATH` to the old file to keep data (migrations run automatically).
- Default API key is now `aliproxy-local-key` (set `PROXY_API_KEY` to keep the old one).
- Response headers renamed `X-Qwen-Proxy-*` → `X-Aliproxy-*`.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` / `build` / `start` | Dashboard |
| `npm run proxy` | Proxy server (watch mode) |
| `npm run proxy:seed-farm` | Seed Echo demo key + groups |
| `npm run proxy:seed` | Seed curated DashScope model groups |
| `npm run proxy:import` | Interactive key import |
| `npm run proxy:create-groups` | Create custom qwen-max/plus/coder/flash groups |
| `npm test` | Vitest suite (46 tests) |

## Known limitations

- Trial quotas are decremented locally (providers don't expose remaining trial tokens); sweep + manual override keep them honest.
- Rate limiter and video-task registry are process-local (single-node product).
- Next.js 14.2.x has a security advisory (2025-12-11); a 15.x upgrade is planned.

## License

MIT — hoard responsibly, and read your providers' ToS.
