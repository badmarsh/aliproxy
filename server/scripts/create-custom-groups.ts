/**
 * create-custom-groups.ts
 *
 * Creates 4 custom model groups:
 * - qwen-max: all max models EXCEPT qwen-max and qwen3-max
 * - qwen-plus: all plus models
 * - qwen-coder: all coder models
 * - qwen-flash: all flash models
 *
 * Usage: npm run proxy:create-groups
 */

import { getDb, closeDb } from "../lib/database.js";
import { createGroup, getGroup, listGroups } from "../lib/group-store.js";
import { listKeys } from "../lib/secret-store.js";
import { createLogger } from "../lib/logger.js";
import type { CandidateModel, ModelCapability } from "../lib/types.js";

const log = createLogger("create-custom-groups");

const C = {
  chat: ["chat", "streaming"] as ModelCapability[],
  chatTools: ["chat", "streaming", "tools"] as ModelCapability[],
  chatVision: ["chat", "streaming", "vision"] as ModelCapability[],
  chatVT: ["chat", "streaming", "vision", "tools"] as ModelCapability[],
  embed: ["embeddings"] as ModelCapability[],
};

function cands(ids: string[], caps: ModelCapability[]): CandidateModel[] {
  return ids.map((id, i) => ({ upstream_model_id: id, priority: i + 1, capabilities: caps }));
}

const CUSTOM_GROUPS = [
  {
    id: "qwen-max",
    display_name: "Qwen Max (All Variants)",
    aliases: ["gpt-4o", "claude-opus-4"],
    // All max models EXCEPT qwen-max and qwen3-max (legacy rolling aliases)
    candidateModels: [
      // Qwen 3.8 Max generation
      "qwen3.8-max-0902",
      "qwen3.8-max",
      // Qwen 3.7 Max generation
      "qwen3.7-max-2026-06-08",
      "qwen3.7-max-preview",
      "qwen3.7-max-2026-05-20",
      "qwen3.7-max-2026-05-17",
      "qwen3.7-max",
      // Qwen 3.6 Max generation
      "qwen3.6-max-preview",
      // Qwen3 Max (with dated snapshots, but NOT the rolling "qwen3-max" alias)
      "qwen3-max-2026-01-23",
      "qwen3-max-2025-09-23",
      "qwen3-max-preview",
    ],
    capabilities: C.chatTools,
  },
  {
    id: "qwen-plus",
    display_name: "Qwen Plus (All Variants)",
    aliases: ["gpt-4o-mini", "claude-haiku-3-5"],
    // All plus models
    candidateModels: [
      // Qwen 3.7 Plus
      "qwen3.7-plus-2026-05-26",
      "qwen3.7-plus",
      // Qwen 3.6 Plus
      "qwen3.6-plus-2026-04-02",
      "qwen3.6-plus",
      // Qwen 3.5 Plus
      "qwen3.5-plus-2026-04-20",
      "qwen3.5-plus-2026-02-15",
      "qwen3.5-plus",
      // Legacy Qwen Plus (all snapshots)
      "qwen-plus-2025-12-01",
      "qwen-plus-2025-09-11",
      "qwen-plus-2025-07-28",
      "qwen-plus-2025-07-14",
      "qwen-plus-2025-04-28",
      "qwen-plus-latest",
      "qwen-plus",
    ],
    capabilities: C.chatTools,
  },
  {
    id: "qwen-coder",
    display_name: "Qwen Coder (All Variants)",
    aliases: ["gpt-4-turbo", "gpt-4"],
    // All coder models
    candidateModels: [
      // Qwen3 Coder Plus
      "qwen3-coder-plus-2025-09-23",
      "qwen3-coder-plus-2025-07-22",
      "qwen3-coder-plus",
      // Qwen3 Coder Flash
      "qwen3-coder-flash-2025-07-28",
      "qwen3-coder-flash",
      // Qwen3 Coder 480B
      "qwen3-coder-480b-a35b-instruct",
      // Qwen3 Coder 30B
      "qwen3-coder-30b-a3b-instruct",
      // Qwen3 Coder Next
      "qwen3-coder-next",
    ],
    capabilities: C.chatTools,
  },
  {
    id: "qwen-flash",
    display_name: "Qwen Flash (All Variants)",
    aliases: ["gpt-3.5-turbo", "claude-haiku-3"],
    // All flash models
    candidateModels: [
      // Qwen 3.8 Flash
      "qwen3.8-flash",
      // Qwen 3.7 Flash
      "qwen3.7-flash-2026-07-15",
      "qwen3.7-flash",
      // Qwen 3.6 Flash
      "qwen3.6-flash-2026-04-16",
      "qwen3.6-flash",
      // Qwen 3.5 Flash
      "qwen3.5-flash-2026-02-23",
      "qwen3.5-flash",
      // Legacy Qwen Flash
      "qwen-flash-2025-07-28",
      "qwen-flash",
      // Qwen3 VL Flash
      "qwen3-vl-flash-2026-01-22",
      "qwen3-vl-flash-2025-10-15",
      "qwen3-vl-flash",
      // Qwen3.5 Omni Flash
      "qwen3.5-omni-flash-2026-03-15",
      "qwen3.5-omni-flash",
      // Qwen3 Omni Flash
      "qwen3-omni-flash-2025-12-01",
      "qwen3-omni-flash-2025-09-15",
      "qwen3-omni-flash",
      // Qwen3 Coder Flash
      "qwen3-coder-flash-2025-07-28",
      "qwen3-coder-flash",
    ],
    capabilities: C.chat,
  },
];

function createCustomGroup(def: typeof CUSTOM_GROUPS[0], keyIds: string[]): "created" | "skipped" | "updated" {
  const existing = getGroup(def.id);
  
  if (existing) {
    log.info(`  · group '${def.id}' already exists`);
    return "skipped";
  }

  createGroup({
    id: def.id,
    display_name: def.display_name,
    aliases: def.aliases,
    candidates: cands(def.candidateModels, def.capabilities),
    key_ids: keyIds,
    strategy: "first_available",
    enabled: true,
  });

  log.info(`  ✓ created '${def.id}' with ${def.candidateModels.length} candidates`);
  return "created";
}

function main() {
  const db = getDb();

  const allKeys = listKeys();
  const allKeyIds = allKeys.map((k) => k.id);
  log.info(`Found ${allKeyIds.length} API keys to attach to custom groups`);

  log.info(`Creating ${CUSTOM_GROUPS.length} custom model groups...`);

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const def of CUSTOM_GROUPS) {
    const result = createCustomGroup(def, allKeyIds);
    if (result === "created") created++;
    else if (result === "skipped") skipped++;
    else if (result === "updated") updated++;
  }

  log.info(`Done — ${created} created, ${skipped} skipped.`);
  log.info(`All ${allKeyIds.length} keys linked to custom groups.`);
  log.info("");
  log.info("Group summary:");
  log.info("  - qwen-max:    all max models (excluding legacy qwen-max, qwen3-max aliases)");
  log.info("  - qwen-plus:   all plus models");
  log.info("  - qwen-coder:  all coder models");
  log.info("  - qwen-flash:  all flash models (text + VL + omni + coder)");
  log.info("");
  log.info("Start the proxy: npm run proxy");

  closeDb();
}

main();
