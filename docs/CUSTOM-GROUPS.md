# Custom Model Groups

Created 2026-09-03 — Four curated model groups for simplified routing.

## Overview

These groups aggregate models by capability tier, making it easier to select the right model class without managing individual model IDs.

| Group | Models | Use Case | Aliases |
|-------|--------|----------|---------|
| `qwen-max` | 11 | Best quality, complex reasoning | `gpt-4o`, `claude-opus-4` |
| `qwen-plus` | 14 | Balanced performance/cost | `gpt-4o-mini`, `claude-haiku-3-5` |
| `qwen-coder` | 8 | Code generation & review | `gpt-4-turbo`, `gpt-4` |
| `qwen-flash` | 19 | Fast, cheap, high-throughput | `gpt-3.5-turbo`, `claude-haiku-3` |

## Group Details

### qwen-max (11 models)

**Purpose:** Maximum capability for complex reasoning, multi-step tasks, and challenging problems.

**Excludes:** Legacy rolling aliases `qwen-max` and `qwen3-max` (use dated snapshots instead).

**Candidates** (priority order):
1. `qwen3.8-max-0902` — Latest Qwen 3.8 Max snapshot
2. `qwen3.8-max` — Qwen 3.8 Max rolling alias
3. `qwen3.7-max-2026-06-08` — Qwen 3.7 Max (newest dated)
4. `qwen3.7-max-preview` — Qwen 3.7 Max preview
5. `qwen3.7-max-2026-05-20` — Qwen 3.7 Max snapshot
6. `qwen3.7-max-2026-05-17` — Qwen 3.7 Max older snapshot
7. `qwen3.7-max` — Qwen 3.7 Max rolling alias
8. `qwen3.6-max-preview` — Qwen 3.6 Max preview
9. `qwen3-max-2026-01-23` — Qwen3 Max (newest dated)
10. `qwen3-max-2025-09-23` — Qwen3 Max snapshot
11. `qwen3-max-preview` — Qwen3 Max preview

**Strategy:** `first_available` — uses the first model with quota available.

---

### qwen-plus (14 models)

**Purpose:** Balanced performance and cost for production workloads.

**Candidates** (priority order):
1. `qwen3.7-plus-2026-05-26` — Qwen 3.7 Plus (newest dated)
2. `qwen3.7-plus` — Qwen 3.7 Plus rolling alias
3. `qwen3.6-plus-2026-04-02` — Qwen 3.6 Plus dated snapshot
4. `qwen3.6-plus` — Qwen 3.6 Plus rolling alias
5. `qwen3.5-plus-2026-04-20` — Qwen 3.5 Plus (newest)
6. `qwen3.5-plus-2026-02-15` — Qwen 3.5 Plus snapshot
7. `qwen3.5-plus` — Qwen 3.5 Plus rolling alias
8. `qwen-plus-2025-12-01` — Legacy Plus (newest snapshot)
9. `qwen-plus-2025-09-11` — Legacy Plus snapshot
10. `qwen-plus-2025-07-28` — Legacy Plus snapshot
11. `qwen-plus-2025-07-14` — Legacy Plus snapshot
12. `qwen-plus-2025-04-28` — Legacy Plus snapshot
13. `qwen-plus-latest` — Legacy Plus managed pointer
14. `qwen-plus` — Legacy Plus rolling alias

**Strategy:** `first_available`

---

### qwen-coder (8 models)

**Purpose:** Code generation, review, refactoring, and technical Q&A.

**Candidates** (priority order):
1. `qwen3-coder-plus-2025-09-23` — Coder Plus (newest dated)
2. `qwen3-coder-plus-2025-07-22` — Coder Plus snapshot
3. `qwen3-coder-plus` — Coder Plus rolling alias
4. `qwen3-coder-flash-2025-07-28` — Coder Flash dated
5. `qwen3-coder-flash` — Coder Flash rolling alias
6. `qwen3-coder-480b-a35b-instruct` — 480B flagship coding model
7. `qwen3-coder-30b-a3b-instruct` — 30B mid-tier coding model
8. `qwen3-coder-next` — Next-gen experimental coder

**Strategy:** `first_available`

---

### qwen-flash (19 models)

**Purpose:** High-throughput, low-latency tasks, simple Q&A, bulk processing.

**Candidates** (priority order):
1. `qwen3.8-flash` — Qwen 3.8 Flash (newest generation)
2. `qwen3.7-flash-2026-07-15` — Qwen 3.7 Flash dated
3. `qwen3.7-flash` — Qwen 3.7 Flash rolling alias
4. `qwen3.6-flash-2026-04-16` — Qwen 3.6 Flash dated
5. `qwen3.6-flash` — Qwen 3.6 Flash rolling alias
6. `qwen3.5-flash-2026-02-23` — Qwen 3.5 Flash dated
7. `qwen3.5-flash` — Qwen 3.5 Flash rolling alias
8. `qwen-flash-2025-07-28` — Legacy Flash dated
9. `qwen-flash` — Legacy Flash rolling alias
10. `qwen3-vl-flash-2026-01-22` — VL Flash (newest)
11. `qwen3-vl-flash-2025-10-15` — VL Flash snapshot
12. `qwen3-vl-flash` — VL Flash rolling alias
13. `qwen3.5-omni-flash-2026-03-15` — Omni Flash (newest)
14. `qwen3.5-omni-flash` — Omni Flash rolling alias
15. `qwen3-omni-flash-2025-12-01` — Omni Flash snapshot
16. `qwen3-omni-flash-2025-09-15` — Omni Flash older snapshot
17. `qwen3-omni-flash` — Omni Flash rolling alias
18. `qwen3-coder-flash-2025-07-28` — Coder Flash (duplicate for coverage)
19. `qwen3-coder-flash` — Coder Flash rolling alias

**Strategy:** `first_available`

**Note:** Includes flash models from text, vision-language (VL), omni (multimodal), and coder families for maximum coverage.

---

## Usage

### Via Proxy API

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer qwen-proxy-local-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-max",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Model Group Routing

All 25 API keys are automatically assigned to all 4 groups. The proxy uses **first_available** strategy:

1. Try models in priority order (newest → oldest)
2. Skip models with `insufficient_quota` errors
3. Rotate to next key when quota exhausted
4. Fall back through the entire candidate list

## Maintenance

### Update Candidates

Edit `server/scripts/update-custom-groups.ts` and re-run:

```bash
npm run proxy:create-groups  # creates if missing
npx tsx server/scripts/update-custom-groups.ts  # updates existing
```

### Add New Generation

When DashScope releases a new generation (e.g., Qwen 3.9):

1. Add new dated snapshot at **position 1** in relevant group(s)
2. Run update script
3. Optionally use `PUT /api/groups/:id` to update live instance without restart

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run proxy:create-groups` | Create groups if they don't exist |
| `npx tsx server/scripts/update-custom-groups.ts` | Update existing groups with new candidate lists |

## Related

- **Phase 0 Discovery:** `docs/upstream-compatibility.md`
- **Model Catalog:** `GET /compatible-mode/v1/models` returns 165 models
- **Key Management:** Admin UI at `http://localhost:3456/keys`
- **Group Management:** Admin UI at `http://localhost:3456/groups`
