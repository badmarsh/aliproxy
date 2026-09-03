# MEGAPROMPT — Aliproxy → Absolute Perfection

> **Role.** You are the senior engineer finishing Aliproxy 2026, a local trial-key farming
> proxy + dashboard. The product works (56 tests green, live preview). Your job is the last
> mile: the gaps a daily user feels. Ship each item below as working, tested software.
>
> **Mission.** Close every high-impact gap in one release (2026.7.0). No mocks, no
> placeholders — each feature verified against the running server.
>
> **Constraints.** Local-first single-node. No feature that requires Alibaba APIs that
> don't exist (no OAuth key minting). Keep secrets out of git. Every UI element wired to a
> real endpoint. Tests for every new endpoint. Build must stay green.

## Context (what exists and must not regress)

Proxy server (Hono, :8080) with chat/embeddings/images/video, trial quotas + radar +
expiry, client keys (RPM/daily budgets/allowlists), usage analytics + savings meter,
pricing catalog, provider presets + Echo mock, intake folder watcher, sweep, health
checks, AES-256-GCM secrets, SQLite migrations. Dashboard (Next 14, :3456): Overview,
Groups, Studio canvas, Quota Radar, Client Keys, Usage & Savings, Playground, Metrics,
Settings — all live data, 56 Vitest tests.

## Execute — the gaps

### P0-1 · Quota Radar is read-only
The `PUT /api/trials/:keyId/:model` endpoint exists but no UI. Perfection: every radar
cell editable inline (kind, limit, expiry) because preset estimates are always slightly
wrong; "show exhausted" filter; sort expiring-first. A radar you can't correct is a radar
you stop trusting.

### P0-2 · Metrics can't answer "was it slow?"
Only averages. Averages lie. Add p50/p95 latency to stats and log filters (model, status
class ok/error, stream/sync) to `GET /api/logs` and the Metrics page. Acceptance: filter
`?status=error` returns only errors; p95 present in summary payload.

### P0-3 · Studio prompt canvas lacks an AI editor
A "state of the art" canvas should co-write prompts. Add **✨ Enhance**: send the compiled
prompt to any chat-capable group with a block-JSON system instruction, parse the response
back into canvas blocks (graceful fallback: lines → custom blocks when the model won't
emit JSON — Echo does this). Zero new server code (reuse the playground passthrough).

### P0-4 · Config is unrecoverable
Groups exist only in SQLite. Add `GET /api/groups/export` + `POST /api/groups/import`
(upsert) and a Settings button pair. A farm you can't back up is a farm you can lose.

### P0-5 · Admin key is hardcoded in the client bundle
`aliproxy-local-key` is baked into `lib/api-client.ts`. Add a runtime override: Settings →
"Admin API key" (stored in localStorage, used for all calls). Keep the default for
first-run DX, but a real deployment must be able to change the key without a rebuild.

### P1-6 · No CLI window into the farm
`npm run farm:status`: keys by status, radar totals, savings number, expiring trials —
straight in the terminal, no browser needed.

### P1-7 · The API surface is undiscoverable
Add `/api-docs` page: every endpoint, methods, auth, curl examples, generated from the
real routes.

### P1-8 · No CI
GitHub Actions: install → test → build on every push/PR. If it isn't tested in CI it
regresses silently.

## Consciously NOT doing (perfection = knowing what to skip)

- OAuth/key-minting — Alibaba exposes no such API; the console + intake folder is the floor.
- Multi-node HA, distributed rate limiting — single-node product by design.
- Persistent video-task registry, WebSocket live pushes — polling suffices at this scale.
- Teams/RBAC/billing, cloud sync, Electron packaging, i18n — product-scope, not gaps.

## Acceptance

1. `npm test` green (existing 56 + new), `tsc` clean, `next build` clean.
2. Live curl verification of every new endpoint against the running server.
3. Radar cell edit round-trip changes the radar totals.
4. Version 2026.7.0, CHANGELOG + README updated, single commit, pushed.
