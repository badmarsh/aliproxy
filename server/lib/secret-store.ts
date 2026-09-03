import { encrypt, decrypt, fingerprint } from "./crypto.js";
import { getDb } from "./database.js";
import { generateId } from "./ids.js";
import { config } from "./config.js";
import { createLogger } from "./logger.js";
import type { ApiKey, ApiKeyWithSecret, KeyType } from "./types.js";

const log = createLogger("secret-store");

function getPassphrase(): string {
  const key = process.env.ENCRYPTION_KEY || config.encryption.key;
  if (!key) {
    throw new Error("ENCRYPTION_KEY not set. Run 'npm run proxy:import' to generate one, or set ENCRYPTION_KEY in .env");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  return encrypt(plaintext, getPassphrase());
}

export function decryptSecret(ciphertext: string): string {
  return decrypt(ciphertext, getPassphrase());
}

export function computeFingerprint(secret: string): string {
  return fingerprint(secret);
}

export interface CreateKeyInput {
  alias: string;
  secret: string;
  key_type: KeyType;
  region: string;
  workspace_id?: string | null;
  base_url: string;
  groups?: string[];
}

export function createKey(input: CreateKeyInput): ApiKey {
  const db = getDb();
  const id = generateId("key");
  const fp = computeFingerprint(input.secret);
  const ciphertext = encryptSecret(input.secret);

  const existing = db.prepare("SELECT id FROM api_keys WHERE fingerprint = ?").get(fp);
  if (existing) {
    throw new Error(`Key with fingerprint ${fp} already exists (id: ${(existing as any).id})`);
  }

  db.prepare(`
    INSERT INTO api_keys (id, alias, secret_ciphertext, fingerprint, key_type, region, workspace_id, base_url, status, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 1)
  `).run(
    id,
    input.alias,
    ciphertext,
    fp,
    input.key_type,
    input.region,
    input.workspace_id || null,
    input.base_url,
  );

  const groups = input.groups || [];
  if (groups.length > 0) {
    const stmt = db.prepare("INSERT OR IGNORE INTO key_groups (key_id, group_id) VALUES (?, ?)");
    for (const groupId of groups) {
      stmt.run(id, groupId);
    }
  }

  log.info("Key created", { id, alias: input.alias, key_type: input.key_type });
  return getKey(id)!;
}

export function getKey(id: string): ApiKey | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as any;
  if (!row) return null;

  const groups = db
    .prepare("SELECT group_id FROM key_groups WHERE key_id = ?")
    .all(id)
    .map((r: any) => r.group_id as string);

  return mapRowToKey(row, groups);
}

export function getKeyWithSecret(id: string): ApiKeyWithSecret | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as any;
  if (!row) return null;

  const groups = db
    .prepare("SELECT group_id FROM key_groups WHERE key_id = ?")
    .all(id)
    .map((r: any) => r.group_id as string);

  return {
    ...mapRowToKey(row, groups),
    secret: decryptSecret(row.secret_ciphertext),
  };
}

export function listKeys(): ApiKey[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC").all() as any[];

  return rows.map((row) => {
    const groups = db
      .prepare("SELECT group_id FROM key_groups WHERE key_id = ?")
      .all(row.id)
      .map((r: any) => r.group_id as string);
    return mapRowToKey(row, groups);
  });
}

export function updateKey(
  id: string,
  updates: Partial<Pick<ApiKey, "alias" | "status" | "enabled" | "cooldown_until" | "last_error_code" | "last_error_message" | "consecutive_failures" | "last_validated_at" | "groups">>,
): ApiKey | null {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.alias !== undefined) {
    fields.push("alias = ?");
    values.push(updates.alias);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }
  if (updates.cooldown_until !== undefined) {
    fields.push("cooldown_until = ?");
    values.push(updates.cooldown_until);
  }
  if (updates.last_error_code !== undefined) {
    fields.push("last_error_code = ?");
    values.push(updates.last_error_code);
  }
  if (updates.last_error_message !== undefined) {
    fields.push("last_error_message = ?");
    values.push(updates.last_error_message);
  }
  if (updates.consecutive_failures !== undefined) {
    fields.push("consecutive_failures = ?");
    values.push(updates.consecutive_failures);
  }
  if (updates.last_validated_at !== undefined) {
    fields.push("last_validated_at = ?");
    values.push(updates.last_validated_at);
  }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE api_keys SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  if (updates.groups !== undefined) {
    db.prepare("DELETE FROM key_groups WHERE key_id = ?").run(id);
    const stmt = db.prepare("INSERT OR IGNORE INTO key_groups (key_id, group_id) VALUES (?, ?)");
    for (const groupId of updates.groups) {
      stmt.run(id, groupId);
    }
  }

  return getKey(id);
}

export function deleteKey(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  return result.changes > 0;
}

export function listKeysByGroup(groupId: string): ApiKey[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT ak.* FROM api_keys ak
      JOIN key_groups kg ON ak.id = kg.key_id
      WHERE kg.group_id = ? AND ak.enabled = 1
      ORDER BY ak.created_at DESC
    `)
    .all(groupId) as any[];

  return rows.map((row) => {
    const groups = db
      .prepare("SELECT group_id FROM key_groups WHERE key_id = ?")
      .all(row.id)
      .map((r: any) => r.group_id as string);
    return mapRowToKey(row, groups);
  });
}

export function getKeysForDispatch(groupId: string): ApiKeyWithSecret[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT ak.* FROM api_keys ak
      JOIN key_groups kg ON ak.id = kg.key_id
      WHERE kg.group_id = ?
        AND ak.enabled = 1
        AND ak.status NOT IN ('invalid', 'disabled')
        AND (ak.cooldown_until IS NULL OR ak.cooldown_until < datetime('now'))
      ORDER BY ak.created_at DESC
    `)
    .all(groupId) as any[];

  return rows.map((row) => {
    const groups = db
      .prepare("SELECT group_id FROM key_groups WHERE key_id = ?")
      .all(row.id)
      .map((r: any) => r.group_id as string);
    return {
      ...mapRowToKey(row, groups),
      secret: decryptSecret(row.secret_ciphertext),
    };
  });
}

function mapRowToKey(row: any, groups: string[]): ApiKey {
  return {
    id: row.id,
    alias: row.alias,
    fingerprint: row.fingerprint,
    key_type: row.key_type,
    region: row.region,
    workspace_id: row.workspace_id,
    base_url: row.base_url,
    status: row.status,
    enabled: row.enabled === 1,
    cooldown_until: row.cooldown_until,
    last_validated_at: row.last_validated_at,
    last_error_code: row.last_error_code,
    last_error_message: row.last_error_message,
    consecutive_failures: row.consecutive_failures,
    groups,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface BatchImportResult {
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
}

export function importKeysBatch(inputs: CreateKeyInput[]): BatchImportResult {
  const db = getDb();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const insertKeyStmt = db.prepare(`
    INSERT INTO api_keys (id, alias, secret_ciphertext, fingerprint, key_type, region, workspace_id, base_url, status, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 1)
  `);

  const insertGroupStmt = db.prepare("INSERT OR IGNORE INTO key_groups (key_id, group_id) VALUES (?, ?)");
  const checkFpStmt = db.prepare("SELECT id FROM api_keys WHERE fingerprint = ?");

  const runBatch = db.transaction(() => {
    for (const input of inputs) {
      if (!input.secret || !input.base_url) {
        errors.push(`Invalid key record: missing secret or base_url`);
        continue;
      }
      try {
        const fp = computeFingerprint(input.secret);
        const existing = checkFpStmt.get(fp);
        if (existing) {
          skipped++;
          continue;
        }

        const id = generateId("key");
        const ciphertext = encryptSecret(input.secret);
        insertKeyStmt.run(
          id,
          input.alias || `Key ${id.slice(-6)}`,
          ciphertext,
          fp,
          input.key_type || "standard",
          input.region || "ap-southeast-1",
          input.workspace_id || null,
          input.base_url,
        );

        if (input.groups && input.groups.length > 0) {
          for (const g of input.groups) {
            insertGroupStmt.run(id, g);
          }
        }
        imported++;
      } catch (err: any) {
        errors.push(`Error importing key '${input.alias}': ${err.message}`);
      }
    }
  });

  runBatch();
  return {
    imported,
    skipped,
    total: inputs.length,
    errors,
  };
}
