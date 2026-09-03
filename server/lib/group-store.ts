import { getDb } from "./database.js";
import { generateId } from "./ids.js";
import { createLogger } from "./logger.js";
import type { ModelGroup, CandidateModel, SelectionStrategy } from "./types.js";

const log = createLogger("group-store");

export interface CreateGroupInput {
  id: string;
  display_name: string;
  aliases?: string[];
  candidates?: CandidateModel[];
  key_ids?: string[];
  strategy?: SelectionStrategy;
  weights?: Record<string, number>;
  fallback_group_ids?: string[];
  enabled?: boolean;
}

export function createGroup(input: CreateGroupInput): ModelGroup {
  const db = getDb();

  const existing = db.prepare("SELECT id FROM model_groups WHERE id = ?").get(input.id);
  if (existing) {
    throw new Error(`Group '${input.id}' already exists`);
  }

  const aliasConflicts = db
    .prepare("SELECT id FROM model_groups WHERE aliases LIKE ?")
    .all(`%"${input.id}"%`);
  if (aliasConflicts.length > 0) {
    throw new Error(`Group ID '${input.id}' conflicts with an existing alias`);
  }

  db.prepare(`
    INSERT INTO model_groups (id, display_name, aliases, candidates, strategy, weights, fallback_group_ids, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.display_name,
    JSON.stringify(input.aliases || []),
    JSON.stringify(input.candidates || []),
    input.strategy || "round_robin",
    JSON.stringify(input.weights || {}),
    JSON.stringify(input.fallback_group_ids || []),
    input.enabled !== false ? 1 : 0,
  );

  if (input.key_ids && input.key_ids.length > 0) {
    const stmt = db.prepare("INSERT OR IGNORE INTO key_groups (key_id, group_id) VALUES (?, ?)");
    for (const keyId of input.key_ids) {
      stmt.run(keyId, input.id);
    }
  }

  log.info("Group created", { id: input.id });
  return getGroup(input.id)!;
}

export function getGroup(id: string): ModelGroup | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM model_groups WHERE id = ?").get(id) as any;
  if (!row) return null;

  const keyIds = db
    .prepare("SELECT key_id FROM key_groups WHERE group_id = ?")
    .all(id)
    .map((r: any) => r.key_id as string);

  return mapRowToGroup(row, keyIds);
}

export function listGroups(): ModelGroup[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM model_groups ORDER BY created_at DESC").all() as any[];

  return rows.map((row) => {
    const keyIds = db
      .prepare("SELECT key_id FROM key_groups WHERE group_id = ?")
      .all(row.id)
      .map((r: any) => r.key_id as string);
    return mapRowToGroup(row, keyIds);
  });
}

export function updateGroup(
  id: string,
  updates: Partial<Omit<CreateGroupInput, "id">>,
): ModelGroup | null {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.display_name !== undefined) {
    fields.push("display_name = ?");
    values.push(updates.display_name);
  }
  if (updates.aliases !== undefined) {
    fields.push("aliases = ?");
    values.push(JSON.stringify(updates.aliases));
  }
  if (updates.candidates !== undefined) {
    fields.push("candidates = ?");
    values.push(JSON.stringify(updates.candidates));
  }
  if (updates.strategy !== undefined) {
    fields.push("strategy = ?");
    values.push(updates.strategy);
  }
  if (updates.weights !== undefined) {
    fields.push("weights = ?");
    values.push(JSON.stringify(updates.weights));
  }
  if (updates.fallback_group_ids !== undefined) {
    fields.push("fallback_group_ids = ?");
    values.push(JSON.stringify(updates.fallback_group_ids));
  }
  if (updates.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }

  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE model_groups SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  if (updates.key_ids !== undefined) {
    db.prepare("DELETE FROM key_groups WHERE group_id = ?").run(id);
    const stmt = db.prepare("INSERT OR IGNORE INTO key_groups (key_id, group_id) VALUES (?, ?)");
    for (const keyId of updates.key_ids) {
      stmt.run(keyId, id);
    }
  }

  return getGroup(id);
}

export function deleteGroup(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM model_groups WHERE id = ?").run(id);
  return result.changes > 0;
}

export function resolveAliasOrGroup(modelId: string): ModelGroup | null {
  const db = getDb();

  const direct = db.prepare("SELECT * FROM model_groups WHERE id = ? AND enabled = 1").get(modelId) as any;
  if (direct) {
    const keyIds = db
      .prepare("SELECT key_id FROM key_groups WHERE group_id = ?")
      .all(direct.id)
      .map((r: any) => r.key_id as string);
    return mapRowToGroup(direct, keyIds);
  }

  const allGroups = db.prepare("SELECT * FROM model_groups WHERE enabled = 1").all() as any[];
  for (const row of allGroups) {
    const aliases = JSON.parse(row.aliases) as string[];
    if (aliases.includes(modelId)) {
      const keyIds = db
        .prepare("SELECT key_id FROM key_groups WHERE group_id = ?")
        .all(row.id)
        .map((r: any) => r.key_id as string);
      return mapRowToGroup(row, keyIds);
    }
  }

  return null;
}

function mapRowToGroup(row: any, keyIds: string[]): ModelGroup {
  return {
    id: row.id,
    display_name: row.display_name,
    aliases: JSON.parse(row.aliases),
    candidates: JSON.parse(row.candidates),
    key_ids: keyIds,
    strategy: row.strategy,
    weights: JSON.parse(row.weights),
    fallback_group_ids: JSON.parse(row.fallback_group_ids),
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
