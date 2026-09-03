/**
 * seed-defaults.ts
 *
 * Seeds predefined model groups from the actual workspace model catalog.
 * Safe to run multiple times — skips groups that already exist.
 *
 * Usage: npm run proxy:seed
 *
 * Versioned model convention
 * --------------------------
 * Candidates are listed newest-dated-first, then rolling alias last.
 * This guarantees clients always hit the latest stable snapshot.
 *
 *   qwen3.8-max-0902  ← priority 1 (newest dated)
 *   qwen3.8-max       ← priority 2 (rolling alias / fallback)
 *
 * Updating for a new DashScope release:
 *   - Add the new dated variant at position 1 in the relevant group's candidateModels.
 *   - Run `npm run proxy:seed` — existing groups are skipped.
 *   - Use PUT /api/groups/:id to update candidates on a live instance.
 */

import { getDb, closeDb } from "../lib/database.js";
import { createGroup, getGroup } from "../lib/group-store.js";
import { createLogger } from "../lib/logger.js";
import type { CandidateModel, ModelCapability, SelectionStrategy } from "../lib/types.js";

const log = createLogger("seed-defaults");

// ─── Capability shorthand sets ────────────────────────────────────────────────

const C = {
  chat:          ["chat", "streaming"] as ModelCapability[],
  chatTools:     ["chat", "streaming", "tools"] as ModelCapability[],
  chatVision:    ["chat", "streaming", "vision"] as ModelCapability[],
  chatVT:        ["chat", "streaming", "vision", "tools"] as ModelCapability[],
  embed:         ["embeddings"] as ModelCapability[],
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function cands(ids: string[], caps: ModelCapability[]): CandidateModel[] {
  return ids.map((id, i) => ({ upstream_model_id: id, priority: i + 1, capabilities: caps }));
}

interface GroupDef {
  id: string;
  display_name: string;
  aliases: string[];
  candidateModels: string[];
  capabilities: ModelCapability[];
  strategy: SelectionStrategy;
}

// ─── Full group catalog ───────────────────────────────────────────────────────
//
// Sources: workspace model console (2026-09-03), 1 M token quota per model.
// Sorted within each family: newest dated snapshot → older snapshots → rolling alias.
// ─────────────────────────────────────────────────────────────────────────────

const GROUPS: GroupDef[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // QWEN 3.8 GENERATION  (newest as of 2026-09)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen3.8-max",
    display_name: "Qwen 3.8 Max",
    // Primary recommendation for "best available" requests
    aliases: ["gpt-4o", "claude-opus-4", "claude-sonnet-4-5"],
    candidateModels: [
      "qwen3.8-max-0902",   // latest dated snapshot
      "qwen3.8-max",        // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.8-flash",
    display_name: "Qwen 3.8 Flash",
    aliases: [],
    candidateModels: [
      "qwen3.8-flash",
    ],
    capabilities: C.chat,
    strategy: "first_available",
  },

  {
    id: "qwen3.8-27b",
    display_name: "Qwen 3.8 27B",
    aliases: [],
    candidateModels: [
      "qwen3.8-27b",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    // Massive MoE: 2.4T total / 95B active
    id: "qwen3.8-2t",
    display_name: "Qwen 3.8 2.4T MoE",
    aliases: [],
    candidateModels: [
      "qwen3.8-2.4t-a95b",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // QWEN 3.7 GENERATION
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen3.7-max",
    display_name: "Qwen 3.7 Max",
    aliases: ["claude-opus-4-5", "gpt-4-1"],
    candidateModels: [
      "qwen3.7-max-2026-06-08",  // newest stable snapshot
      "qwen3.7-max-preview",      // preview
      "qwen3.7-max-2026-05-20",  // previous snapshot
      "qwen3.7-max-2026-05-17",  // older snapshot
      "qwen3.7-max",              // rolling alias
    ],
    capabilities: C.chatVT,
    strategy: "first_available",
  },

  {
    id: "qwen3.7-plus",
    display_name: "Qwen 3.7 Plus",
    aliases: ["gpt-4o-mini", "claude-haiku-3-5"],
    candidateModels: [
      "qwen3.7-plus-2026-05-26",  // only known dated snapshot
      "qwen3.7-plus",              // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.7-flash",
    display_name: "Qwen 3.7 Flash",
    aliases: ["gpt-3.5-turbo"],
    candidateModels: [
      "qwen3.7-flash-2026-07-15",  // newest dated snapshot
      "qwen3.7-flash",              // rolling alias
    ],
    capabilities: C.chat,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // QWEN 3.6 GENERATION
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen3.6-max",
    display_name: "Qwen 3.6 Max (Preview)",
    aliases: [],
    candidateModels: [
      "qwen3.6-max-preview",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.6-plus",
    display_name: "Qwen 3.6 Plus",
    aliases: [],
    candidateModels: [
      "qwen3.6-plus-2026-04-02",  // dated snapshot
      "qwen3.6-plus",              // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.6-flash",
    display_name: "Qwen 3.6 Flash",
    aliases: [],
    candidateModels: [
      "qwen3.6-flash-2026-04-16",  // dated snapshot
      "qwen3.6-flash",              // rolling alias
    ],
    capabilities: C.chat,
    strategy: "first_available",
  },

  {
    id: "qwen3.6-27b",
    display_name: "Qwen 3.6 27B",
    aliases: [],
    candidateModels: ["qwen3.6-27b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.6-35b",
    display_name: "Qwen 3.6 35B MoE",
    aliases: [],
    candidateModels: ["qwen3.6-35b-a3b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // QWEN 3.5 GENERATION
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen3.5-plus",
    display_name: "Qwen 3.5 Plus",
    aliases: [],
    candidateModels: [
      "qwen3.5-plus-2026-04-20",  // newest dated
      "qwen3.5-plus-2026-02-15",
      "qwen3.5-plus",              // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.5-flash",
    display_name: "Qwen 3.5 Flash",
    aliases: [],
    candidateModels: [
      "qwen3.5-flash-2026-02-23",  // dated snapshot
      "qwen3.5-flash",              // rolling alias
    ],
    capabilities: C.chat,
    strategy: "first_available",
  },

  {
    id: "qwen3.5-27b",
    display_name: "Qwen 3.5 27B",
    aliases: [],
    candidateModels: ["qwen3.5-27b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.5-35b",
    display_name: "Qwen 3.5 35B MoE",
    aliases: [],
    candidateModels: ["qwen3.5-35b-a3b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.5-122b",
    display_name: "Qwen 3.5 122B MoE",
    aliases: [],
    candidateModels: ["qwen3.5-122b-a10b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3.5-397b",
    display_name: "Qwen 3.5 397B MoE",
    aliases: [],
    candidateModels: ["qwen3.5-397b-a17b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // QWEN 3 GENERATION (dense + MoE flagships)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen3-max",
    display_name: "Qwen3 Max",
    aliases: [],
    candidateModels: [
      "qwen3-max-2026-01-23",  // newest dated
      "qwen3-max-2025-09-23",
      "qwen3-max-preview",
      "qwen3-max",             // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    // 235B MoE — largest open model; instruct variant
    id: "qwen3-235b",
    display_name: "Qwen3 235B MoE (Instruct)",
    aliases: [],
    candidateModels: [
      "qwen3-235b-a22b-instruct-2507",  // newest instruct snapshot
      "qwen3-235b-a22b",                 // rolling alias (instruct by default)
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    // 235B MoE — thinking/reasoning variant
    id: "qwen3-235b-thinking",
    display_name: "Qwen3 235B MoE (Thinking)",
    aliases: [],
    candidateModels: [
      "qwen3-235b-a22b-thinking-2507",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-30b",
    display_name: "Qwen3 30B MoE (Instruct)",
    aliases: [],
    candidateModels: [
      "qwen3-30b-a3b-instruct-2507",
      "qwen3-30b-a3b",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-30b-thinking",
    display_name: "Qwen3 30B MoE (Thinking)",
    aliases: [],
    candidateModels: [
      "qwen3-30b-a3b-thinking-2507",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-32b",
    display_name: "Qwen3 32B",
    aliases: [],
    candidateModels: ["qwen3-32b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-14b",
    display_name: "Qwen3 14B",
    aliases: [],
    candidateModels: ["qwen3-14b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-8b",
    display_name: "Qwen3 8B",
    aliases: [],
    candidateModels: ["qwen3-8b"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    // Experimental next-gen MoE
    id: "qwen3-next-80b",
    display_name: "Qwen3 Next 80B MoE",
    aliases: [],
    candidateModels: [
      "qwen3-next-80b-a3b-instruct",
      "qwen3-next-80b-a3b-thinking",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // QWEN (legacy rolling aliases — stable, slower update cadence)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen-max",
    display_name: "Qwen Max (Legacy)",
    aliases: [],
    candidateModels: ["qwen-max"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen-plus",
    display_name: "Qwen Plus (Legacy)",
    aliases: [],
    candidateModels: [
      "qwen-plus-2025-12-01",   // newest dated
      "qwen-plus-2025-09-11",
      "qwen-plus-2025-07-28",
      "qwen-plus-2025-07-14",
      "qwen-plus-2025-04-28",
      "qwen-plus-latest",        // DashScope-managed latest pointer
      "qwen-plus",               // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen-turbo",
    display_name: "Qwen Turbo (Legacy)",
    aliases: [],
    candidateModels: ["qwen-turbo"],
    capabilities: C.chat,
    strategy: "first_available",
  },

  {
    id: "qwen-flash",
    display_name: "Qwen Flash (Legacy)",
    aliases: [],
    candidateModels: [
      "qwen-flash-2025-07-28",
      "qwen-flash",
    ],
    capabilities: C.chat,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CODER MODELS
  // ══════════════════════════════════════════════════════════════════════════

  {
    // Primary coding recommendation: 480B flagship or coder-next
    id: "qwen3-coder-plus",
    display_name: "Qwen3 Coder Plus",
    aliases: ["gpt-4-turbo"],
    candidateModels: [
      "qwen3-coder-plus-2025-09-23",  // newest dated
      "qwen3-coder-plus-2025-07-22",
      "qwen3-coder-plus",              // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-coder-flash",
    display_name: "Qwen3 Coder Flash",
    aliases: [],
    candidateModels: [
      "qwen3-coder-flash-2025-07-28",
      "qwen3-coder-flash",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    // Massive 480B coding model
    id: "qwen3-coder-480b",
    display_name: "Qwen3 Coder 480B",
    aliases: [],
    candidateModels: [
      "qwen3-coder-480b-a35b-instruct",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-coder-30b",
    display_name: "Qwen3 Coder 30B",
    aliases: [],
    candidateModels: [
      "qwen3-coder-30b-a3b-instruct",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "qwen3-coder-next",
    display_name: "Qwen3 Coder Next",
    aliases: [],
    candidateModels: ["qwen3-coder-next"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // VISION / VL MODELS  (TEXT section of DashScope; work via compatible-mode)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen3-vl-plus",
    display_name: "Qwen3 VL Plus",
    aliases: ["gpt-4-vision-preview"],
    candidateModels: [
      "qwen3-vl-plus-2025-12-19",  // newest dated
      "qwen3-vl-plus-2025-09-23",
      "qwen3-vl-plus",              // rolling alias
    ],
    capabilities: C.chatVT,
    strategy: "first_available",
  },

  {
    id: "qwen3-vl-flash",
    display_name: "Qwen3 VL Flash",
    aliases: [],
    candidateModels: [
      "qwen3-vl-flash-2026-01-22",  // newest dated
      "qwen3-vl-flash-2025-10-15",
      "qwen3-vl-flash",              // rolling alias
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    id: "qwen3-vl-32b",
    display_name: "Qwen3 VL 32B",
    aliases: [],
    candidateModels: [
      "qwen3-vl-32b-instruct",
      "qwen3-vl-32b-thinking",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    id: "qwen3-vl-235b",
    display_name: "Qwen3 VL 235B MoE",
    aliases: [],
    candidateModels: [
      "qwen3-vl-235b-a22b-instruct",
      "qwen3-vl-235b-a22b-thinking",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    id: "qwen3-vl-30b",
    display_name: "Qwen3 VL 30B MoE",
    aliases: [],
    candidateModels: [
      "qwen3-vl-30b-a3b-instruct",
      "qwen3-vl-30b-a3b-thinking",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    id: "qwen3-vl-8b",
    display_name: "Qwen3 VL 8B",
    aliases: [],
    candidateModels: [
      "qwen3-vl-8b-instruct",
      "qwen3-vl-8b-thinking",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    // Legacy vision — still widely used
    id: "qwen-vl",
    display_name: "Qwen VL (Legacy)",
    aliases: [],
    candidateModels: [
      "qwen-vl-max",
      "qwen-vl-plus",
    ],
    capabilities: C.chatVT,
    strategy: "first_available",
  },

  {
    id: "qwen-vl-ocr",
    display_name: "Qwen VL OCR",
    aliases: [],
    candidateModels: [
      "qwen-vl-ocr-2025-11-20",
      "qwen-vl-ocr",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // REASONING MODELS (QVQ / QWQ)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qvq-max",
    display_name: "QVQ Max (Video Reasoning)",
    aliases: [],
    candidateModels: ["qvq-max"],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    id: "qwq-plus",
    display_name: "QWQ Plus (Reasoning)",
    aliases: ["o1", "o3-mini"],
    candidateModels: ["qwq-plus"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MULTIMODAL / OMNI  (audio + text + vision, chat-compatible endpoint)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen3.5-omni-plus",
    display_name: "Qwen3.5 Omni Plus",
    aliases: [],
    candidateModels: [
      "qwen3.5-omni-plus-2026-03-15",
      "qwen3.5-omni-plus",
    ],
    capabilities: C.chatVT,
    strategy: "first_available",
  },

  {
    id: "qwen3.5-omni-flash",
    display_name: "Qwen3.5 Omni Flash",
    aliases: [],
    candidateModels: [
      "qwen3.5-omni-flash-2026-03-15",
      "qwen3.5-omni-flash",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    id: "qwen3-omni-flash",
    display_name: "Qwen3 Omni Flash",
    aliases: [],
    candidateModels: [
      "qwen3-omni-flash-2025-12-01",
      "qwen3-omni-flash-2025-09-15",
      "qwen3-omni-flash",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  {
    id: "qwen-omni-turbo",
    display_name: "Qwen Omni Turbo (Legacy)",
    aliases: [],
    candidateModels: [
      "qwen-omni-turbo-2025-03-26",
      "qwen-omni-turbo",
    ],
    capabilities: C.chatVision,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // THIRD-PARTY MODELS (hosted on DashScope)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "deepseek-v4",
    display_name: "DeepSeek V4 Pro",
    aliases: [],
    candidateModels: [
      "deepseek-v4-pro-0813",  // newest dated
      "deepseek-v4-pro",       // rolling alias
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "deepseek-v4-flash",
    display_name: "DeepSeek V4 Flash",
    aliases: [],
    candidateModels: [
      "deepseek-v4-flash-0731",
      "deepseek-v4-flash",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "deepseek-v3",
    display_name: "DeepSeek V3.2",
    aliases: [],
    candidateModels: ["deepseek-v3.2"],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "kimi",
    display_name: "Kimi K3",
    aliases: [],
    candidateModels: [
      "kimi-k3",
      "kimi-k2.7-code",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  {
    id: "glm",
    display_name: "GLM",
    aliases: [],
    candidateModels: [
      "glm-5.2",  // newer
      "glm-5.1",
    ],
    capabilities: C.chatTools,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSLATION  (qwen-mt-*)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "qwen-mt",
    display_name: "Qwen Machine Translation",
    aliases: [],
    candidateModels: [
      "qwen-mt-plus",   // highest quality
      "qwen-mt-turbo",
      "qwen-mt-flash",  // fastest
      "qwen-mt-lite",   // lightest
    ],
    capabilities: C.chat,
    strategy: "first_available",
  },

  // ══════════════════════════════════════════════════════════════════════════
  // EMBEDDINGS
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "embedding",
    display_name: "Text Embeddings",
    aliases: ["text-embedding-ada-002", "text-embedding-3-small", "text-embedding-3-large"],
    candidateModels: [
      "qwen3.7-text-embedding",  // newest generation
      "text-embedding-v4",
      "text-embedding-v3",
    ],
    capabilities: C.embed,
    strategy: "first_available",
  },

  {
    id: "embedding-vision",
    display_name: "Vision Embeddings",
    aliases: [],
    candidateModels: [
      "tongyi-embedding-vision-plus",
      "tongyi-embedding-vision-flash",
    ],
    capabilities: C.embed,
    strategy: "first_available",
  },

  {
    id: "rerank",
    display_name: "Reranker",
    aliases: [],
    candidateModels: ["qwen3-rerank"],
    capabilities: C.embed,
    strategy: "first_available",
  },
];

import { listKeys } from "../lib/secret-store.js";

// ─── Seed runner ──────────────────────────────────────────────────────────────

function seedGroup(def: GroupDef, keyIds: string[]): "created" | "skipped" {
  if (getGroup(def.id)) return "skipped";

  createGroup({
    id: def.id,
    display_name: def.display_name,
    aliases: def.aliases,
    candidates: cands(def.candidateModels, def.capabilities),
    key_ids: keyIds,
    strategy: def.strategy,
    enabled: true,
  });

  return "created";
}

function main() {
  const db = getDb();

  // Clear conflicting aliases on legacy 'default' group if present
  const defaultGroup = db.prepare("SELECT * FROM model_groups WHERE id = 'default'").get() as any;
  if (defaultGroup) {
    db.prepare("UPDATE model_groups SET aliases = '[]' WHERE id = 'default'").run();
    log.info("Cleared legacy 'default' group aliases to prevent conflict with canonical model IDs");
  }

  const allKeys = listKeys();
  const allKeyIds = allKeys.map((k) => k.id);
  log.info(`Found ${allKeyIds.length} existing API keys to attach to seeded groups`);

  log.info(`Seeding ${GROUPS.length} default model groups...`);

  let created = 0;
  let skipped = 0;

  for (const def of GROUPS) {
    const result = seedGroup(def, allKeyIds);
    if (result === "created") {
      log.info(`  ✓ created  ${def.id}  (${def.candidateModels.length} candidate${def.candidateModels.length > 1 ? "s" : ""})`);
      created++;
    } else {
      log.info(`  · skipped  ${def.id}`);
      skipped++;
    }
  }

  // Ensure all existing keys are linked to all groups
  const linkStmt = db.prepare("INSERT OR IGNORE INTO key_groups (key_id, group_id) VALUES (?, ?)");
  for (const def of GROUPS) {
    for (const keyId of allKeyIds) {
      linkStmt.run(keyId, def.id);
    }
  }

  log.info(`Done — ${created} created, ${skipped} skipped.`);
  log.info(`All ${allKeyIds.length} keys linked to ${GROUPS.length} model groups.`);
  log.info("Start the proxy: npm run proxy");

  closeDb();
}

main();
