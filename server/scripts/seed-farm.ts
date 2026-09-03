/**
 * seed-farm.ts — one-command demo of the Trial Farm.
 *
 * Creates (idempotently):
 *   1. An "Echo" upstream key pointed at the built-in mock provider
 *      (echo://local — no network, no credentials).
 *   2. Demo groups covering every modality:
 *        aliproxy-demo · chat (+streaming/tools/vision)
 *        echo-image    · image generation   (POST /v1/images/generations)
 *        echo-video    · video generation   (POST /v1/videos/generations)
 *        echo-embed    · embeddings         (POST /v1/embeddings)
 *
 * Usage: npm run proxy:seed-farm
 */

import { closeDb, getDb } from "../lib/database.js";
import { createGroup, getGroup } from "../lib/group-store.js";
import { createKey, listKeys } from "../lib/secret-store.js";
import { seedTrialsForKey } from "../lib/trial-store.js";
import { createLogger } from "../lib/logger.js";
import type { ModelCapability } from "../lib/types.js";

const log = createLogger("seed-farm");

const ECHO_BASE_URL = "echo://local";

const GROUPS = [
  {
    id: "aliproxy-demo",
    display_name: "Aliproxy Demo (Echo)",
    aliases: ["demo", "gpt-4o-mini"],
    candidates: [
      { upstream_model_id: "echo-chat", priority: 1, capabilities: ["chat", "streaming", "tools"] as ModelCapability[] },
      { upstream_model_id: "echo-chat-pro", priority: 2, capabilities: ["chat", "streaming", "tools", "vision"] as ModelCapability[] },
    ],
    strategy: "first_available" as const,
  },
  {
    id: "echo-image",
    display_name: "Echo Image Generation",
    aliases: ["dall-e-3"],
    candidates: [{ upstream_model_id: "echo-image", priority: 1, capabilities: ["images"] as ModelCapability[] }],
    strategy: "first_available" as const,
  },
  {
    id: "echo-video",
    display_name: "Echo Video Generation",
    aliases: ["sora-2"],
    candidates: [{ upstream_model_id: "echo-video", priority: 1, capabilities: ["video"] as ModelCapability[] }],
    strategy: "first_available" as const,
  },
  {
    id: "echo-embed",
    display_name: "Echo Embeddings",
    aliases: ["text-embedding-3-small"],
    candidates: [{ upstream_model_id: "echo-embed", priority: 1, capabilities: ["embeddings"] as ModelCapability[] }],
    strategy: "first_available" as const,
  },
];

function main(): void {
  getDb();

  // 1. Echo key (skip if one already exists)
  const existing = listKeys().find((k) => k.base_url === ECHO_BASE_URL);
  let keyId = existing?.id;
  if (!keyId) {
    const key = createKey({
      alias: "Echo (built-in mock)",
      secret: "echo-local",
      key_type: "standard",
      region: "local",
      workspace_id: null,
      base_url: ECHO_BASE_URL,
      groups: GROUPS.map((g) => g.id),
    });
    keyId = key.id;
    log.info("Echo key created", { id: keyId });
  } else {
    log.info("Echo key already exists", { id: keyId });
  }

  // 2. Groups
  for (const def of GROUPS) {
    if (getGroup(def.id)) {
      log.info("Group exists, skipping", { id: def.id });
      continue;
    }
    createGroup(def);
    log.info("Group created", { id: def.id });
  }

  // 3. Trial rows (echo has none in presets, but this also tops up any real keys)
  const seeded = seedTrialsForKey(keyId, ECHO_BASE_URL);
  log.info("Done", { echoKey: keyId, groups: GROUPS.length, trialRowsSeeded: seeded });
  console.log(`
✅ Trial Farm ready.

   Chat:      POST http://127.0.0.1:8080/v1/chat/completions      {"model":"aliproxy-demo",...}
   Images:    POST http://127.0.0.1:8080/v1/images/generations    {"model":"echo-image","prompt":"..."}
   Video:     POST http://127.0.0.1:8080/v1/videos/generations    {"model":"echo-video","input":{"prompt":"..."}}
   Embeddings:POST http://127.0.0.1:8080/v1/embeddings            {"model":"echo-embed","input":"..."}

   Auth: Bearer <master key or sk-aliproxy-* client key>
`);
  closeDb();
}

main();
