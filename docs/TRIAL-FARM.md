# Trial Farm — a field guide for free-trial key hoarders

Alibaba gives each fresh DashScope account roughly **1M free tokens per LLM** (qwen3.8-max,
qwen-plus, qwen-vl, embeddings, …) plus call-based trials for **wanx image** and **wan
video** models. Other providers run similar promotions (DeepSeek, Groq free tier, …).
Alibaba also expires them. The whole game is: **pool every key, drain the dying quota
first, never accidentally pay.**

This guide walks the loop. Everything works offline against the built-in Echo provider —
`npm run proxy:seed-farm` to start.

---

## 1. Stock the farm

**One key at a time** — Dashboard → Overview → *Add New Key*. Pick a provider preset
(its trial quotas seed automatically), paste the secret. Secrets are AES-256-GCM
encrypted; only fingerprints are ever shown again.

**In bulk** — Dashboard accepts JSON arrays, `{ keys: [...] }`, raw `sk-…` lines, or the
CSV export format from the DashScope console:

```bash
curl -X POST localhost:8080/api/keys/import \
  -H "Authorization: Bearer $MASTER" -H "Content-Type: application/json" \
  -d '{"text": "sk-key-one\nsk-key-two\nsk-key-three"}'
```

Trial rows seed on import for every recognized provider.

> Presets are estimates — promotions differ by region and month. Fix any cell:
> `PUT /api/trials/:keyId/:model {"kind":"tokens","limit_amount":1000000}` or edit from
> the Quota Radar (coming to the UI). A JSON override file works too:
> `TRIAL_PRESETS_PATH=./my-presets.json`.

## 2. Sweep

`POST /api/keys/sweep` (Overview → *Run sweep*) hits every key's `/models` endpoint,
marks the dead ones (`invalid`), refreshes statuses, and tops up missing trial rows.
Run it after every import and whenever a promotion changes.

## 3. Read the Quota Radar

`/quota-radar` — a model × key matrix:

- **Green bar** — quota left; **amber ≥75% used**; **red = spent/expired**
- **Totals row** — free tokens + free image/video calls remaining across the farm
- **⏰ Burning soon** — trials with quota left that expire within 7 days

`first_available` groups automatically prefer the soonest-expiring live key, so expiring
quota drains first without any manual juggling.

## 4. Route around exhaustion

Groups map a client-facing model name to upstream candidates. With several trial keys in
one group:

- A key whose trial for that model is **spent is skipped automatically** (other models on
  the same key still work — tracking is per key × model).
- An upstream `quota_exhausted` error **burns the matching trial row**, so the key drops
  out of rotation for that model immediately.
- When *every* key's trial is spent, Aliproxy returns **`503 trial_exhausted`** instead of
  quietly using a paid key. Attach a paid key to the group (it has no trial rows → never
  filtered) and it becomes the automatic last resort.

```bash
# 3 trial keys + 1 paid key, one model name
curl -X POST localhost:8080/api/groups -H "Authorization: Bearer $MASTER" \
  -d '{"id":"qwen3.8-max","display_name":"Max (trial pool)",
       "candidates":[{"upstream_model_id":"qwen3.8-max","priority":1,
                       "capabilities":["chat","streaming","tools"]}],
       "strategy":"first_available"}'
```

## 5. Spend the free image/video trials

```bash
# images — OpenAI shape, translated to DashScope text2image (async + poll, one call)
curl localhost:8080/v1/images/generations -H "Authorization: Bearer $MASTER" \
  -d '{"model":"wanx2.1-t2i-turbo","prompt":"a hoarder dragon on a pile of API keys"}'

# videos — submit, then poll until SUCCEEDED
TID=$(curl -s -X POST localhost:8080/v1/videos/generations \
  -H "Authorization: Bearer $MASTER" \
  -d '{"model":"wan2.1-t2v-turbo","input":{"prompt":"same dragon, flying"}}' \
  | jq -r .output.task_id)
curl localhost:8080/v1/videos/generations/$TID -H "Authorization: Bearer $MASTER"
```

Each successful generation consumes one **call** from that key × model trial row.

## 6. Share the farm without getting burned

Issue client keys instead of the master key (Dashboard → Client Keys):

- **RPM limit** — sliding-window 429s with `Retry-After`
- **Daily request / token budgets** — reset 00:00 UTC, error codes
  `client_key_daily_requests_exceeded` / `client_key_daily_tokens_exceeded`
- **Group allowlist** — `allowed_group_ids` restricts which groups (models) the key may
  touch; anything else → `403 group_not_allowed`
- **Rotate** any time; the old token dies instantly

## 7. Watch the savings meter

Usage & Savings shows every metered token priced against the catalog and summed as
**estimated spend avoided** — the scoreboard of a successful hoard. Daily series, top
models by value, per-consumer split (master vs each client key).

---

## Cheat sheet

| Thing | Where |
|---|---|
| Trial matrix | `GET /api/trials/radar` · `/quota-radar` |
| Expiring ≤7d | `GET /api/trials/expiring?days=7` |
| Reseed trials | `POST /api/trials/reseed[?key_id=…]` |
| Override a quota | `PUT /api/trials/:keyId/:model` |
| Sweep keys | `POST /api/keys/sweep` |
| Issue client key | `POST /api/client-keys` (+ `/rotate`, PUT, DELETE) |
| Usage / savings | `GET /api/usage/summary|daily|savings` · `/usage` |
| Savings number | `GET /api/usage/savings` → `estimated_spend_avoided_usd` |

**Disclaimer:** quotas here are local estimates; providers don't expose remaining trial
tokens. Sweep often, override when reality disagrees. And read your providers' terms —
this tool pools *your* keys; don't be the reason a free tier gets cancelled.
