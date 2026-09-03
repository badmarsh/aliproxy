import { readdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAllCsvKeys, detectKeyType, detectRegion } from "../lib/csv-parser.js";
import { getDb, closeDb } from "../lib/database.js";
import { createKey, listKeys } from "../lib/secret-store.js";
import { generateEncryptionPassphrase } from "../lib/crypto.js";
import { createLogger } from "../lib/logger.js";
import { config } from "../lib/config.js";
import type { KeyType } from "../lib/types.js";

const log = createLogger("import-keys");

function main() {
  const keysDir = resolve(process.cwd(), "keys");

  // Ensure encryption key exists
  if (!config.encryption.key) {
    const newKey = generateEncryptionPassphrase();
    log.info("Generated new encryption key. Add this to your .env file:");
    log.info(`ENCRYPTION_KEY=${newKey}`);

    const envPath = resolve(process.cwd(), ".env");
    if (existsSync(envPath)) {
      let env = readFileSync(envPath, "utf-8");
      env = env.replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${newKey}`);
      writeFileSync(envPath, env);
      log.info("Updated .env file with ENCRYPTION_KEY");
    }

    process.env.ENCRYPTION_KEY = newKey;
  }

  // Initialize database
  getDb();

  // Parse all CSV files from the keys/ directory
  const records = parseAllCsvKeys(keysDir);
  log.info(`Found ${records.length} keys in CSV files`);

  const existing = listKeys();
  const existingFingerprints = new Set(existing.map((k) => k.fingerprint));
  log.info(`Already have ${existing.length} keys in database`);

  let imported = 0;
  let skipped = 0;

  for (const record of records) {
    const keyType = detectKeyType(record.apiKey);
    const region = detectRegion(record.apiHost);
    const alias = `${record.workspaceName || "workspace"}-${record.id}`;

    try {
      createKey({
        alias,
        secret: record.apiKey,
        key_type: keyType as KeyType,
        region,
        workspace_id: record.workspaceId,
        base_url: record.openAiCompatible,
        // Keys are not auto-assigned to groups — use the Admin UI or
        // PUT /api/keys/:id to assign them after running proxy:seed.
        groups: [],
      });
      imported++;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("already exists")) {
        skipped++;
      } else {
        log.warn(`Failed to import key ${record.id}`, { error: msg });
      }
    }
  }

  log.info("Key import complete", { imported, skipped, total: records.length });
  log.info("Next steps:");
  log.info("  1. npm run proxy:seed      — create default model groups");
  log.info("  2. npm run proxy           — start the proxy server");
  log.info("  3. Open the Admin UI to assign keys to groups");

  closeDb();
}

main();
