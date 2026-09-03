/**
 * Virtual client keys — Aliproxy's own issued API keys.
 *
 * Upstream keys (DashScope, OpenAI, …) live in secret-store. Client keys are
 * what you hand out to applications: `sk-aliproxy-…` tokens that authenticate
 * against the proxy, can be scoped to specific model groups, and carry their
 * own rate limits and daily budgets.
 *
 * Only the SHA-256 hash of the token is stored; the plaintext is shown once
 * at creation/rotation time.
 */

import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./database.js";
import { generateId } from "./ids.js";
import { estimateCost } from "./pricing.js";

export const CLIENT_KEY_PREFIX = "sk-aliproxy-";
/** Synthetic usage identifier used for traffic authenticated with the master key. */
export const MASTER_USAGE_ID = "__master__";

export interface ClientKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  enabled: boolean;
  rpm_limit: number | null;
  daily_request_limit: number | null;
  daily_token_budget: number | null;
  allowed_group_ids: string[];
  total_requests: number;
  total_tokens: number;
  total_cost_usd: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientKeyUsage {
  requests: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return `${CLIENT_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CreateClientKeyInput {
  name: string;
  rpm_limit?: number | null;
  daily_request_limit?: number | null;
  daily_token_budget?: number | null;
  allowed_group_ids?: string[];
}

export function createClientKey(
  input: CreateClientKeyInput,
): { record: ClientKey; plaintext: string } {
  const db = getDb();
  if (!input.name || !input.name.trim()) {
    throw new Error("name is required");
  }

  const id = generateId("ck");
  const plaintext = generateToken();
  const keyHash = hashToken(plaintext);
  const keyPrefix = plaintext.slice(0, CLIENT_KEY_PREFIX.length + 8);

  db.prepare(`
    INSERT INTO client_keys (
      id, name, key_hash, key_prefix, enabled,
      rpm_limit, daily_request_limit, daily_token_budget, allowed_group_ids,
      total_requests, total_tokens, total_cost_usd, last_used_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 0, 0, 0, NULL, datetime('now'), datetime('now'))
  `).run(
    id,
    input.name.trim(),
    keyHash,
    keyPrefix,
    input.rpm_limit ?? null,
    input.daily_request_limit ?? null,
    input.daily_token_budget ?? null,
    JSON.stringify(input.allowed_group_ids || []),
  );

  return { record: getClientKey(id)!, plaintext };
}

export function getClientKey(id: string): ClientKey | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM client_keys WHERE id = ?").get(id) as any;
  return row ? mapRow(row) : null;
}

export function listClientKeys(): ClientKey[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM client_keys ORDER BY created_at DESC").all() as any[];
  return rows.map(mapRow);
}

/** Look up a client key by the raw token. Returns null for unknown tokens. */
export function authenticateClientKey(token: string): ClientKey | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM client_keys WHERE key_hash = ?")
    .get(hashToken(token)) as any;
  return row ? mapRow(row) : null;
}

export function updateClientKey(
  id: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    rpm_limit: number | null;
    daily_request_limit: number | null;
    daily_token_budget: number | null;
    allowed_group_ids: string[];
  }>,
): ClientKey | null {
  const db = getDb();
  const existing = getClientKey(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE client_keys SET
      name = ?, enabled = ?, rpm_limit = ?, daily_request_limit = ?, daily_token_budget = ?,
      allowed_group_ids = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    patch.name?.trim() || existing.name,
    patch.enabled ?? existing.enabled ? 1 : 0,
    patch.rpm_limit !== undefined ? patch.rpm_limit : existing.rpm_limit,
    patch.daily_request_limit !== undefined ? patch.daily_request_limit : existing.daily_request_limit,
    patch.daily_token_budget !== undefined ? patch.daily_token_budget : existing.daily_token_budget,
    JSON.stringify(patch.allowed_group_ids || existing.allowed_group_ids),
    id,
  );

  return getClientKey(id);
}

export function deleteClientKey(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM client_keys WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Issue a fresh token for an existing key record. Old token stops working immediately. */
export function rotateClientKey(id: string): { record: ClientKey; plaintext: string } | null {
  const db = getDb();
  const existing = getClientKey(id);
  if (!existing) return null;

  const plaintext = generateToken();
  const keyPrefix = plaintext.slice(0, CLIENT_KEY_PREFIX.length + 8);

  db.prepare(`
    UPDATE client_keys SET key_hash = ?, key_prefix = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(hashToken(plaintext), keyPrefix, id);

  return { record: getClientKey(id)!, plaintext };
}

/** Today's usage for a client key (UTC date), from the usage_daily rollup. */
export function getTodayUsage(id: string): ClientKeyUsage {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(requests),0) as requests, COALESCE(SUM(errors),0) as errors,
              COALESCE(SUM(prompt_tokens),0) as prompt_tokens, COALESCE(SUM(completion_tokens),0) as completion_tokens,
              COALESCE(SUM(cost_usd),0) as cost_usd
       FROM usage_daily WHERE client_key_id = ? AND date = ?`,
    )
    .get(id, today()) as any;
  return {
    requests: row?.requests || 0,
    errors: row?.errors || 0,
    prompt_tokens: row?.prompt_tokens || 0,
    completion_tokens: row?.completion_tokens || 0,
    cost_usd: row?.cost_usd || 0,
  };
}

export type LimitCheck =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** Check daily request / token budgets. Called after rate limiting. */
export function checkDailyLimits(key: ClientKey): LimitCheck {
  const usage = getTodayUsage(key.id);

  if (key.daily_request_limit && usage.requests >= key.daily_request_limit) {
    return {
      ok: false,
      code: "client_key_daily_requests_exceeded",
      message: `Daily request limit reached (${usage.requests}/${key.daily_request_limit}). Resets at 00:00 UTC.`,
    };
  }

  if (key.daily_token_budget) {
    const tokens = usage.prompt_tokens + usage.completion_tokens;
    if (tokens >= key.daily_token_budget) {
      return {
        ok: false,
        code: "client_key_daily_tokens_exceeded",
        message: `Daily token budget reached (${tokens}/${key.daily_token_budget}). Resets at 00:00 UTC.`,
      };
    }
  }

  return { ok: true };
}

export interface RecordUsageInput {
  client_key_id: string; // client key id or MASTER_USAGE_ID
  group_id: string | null;
  model: string;
  status_code: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

/**
 * Record one request against the daily rollup + lifetime counters.
 * Master-key traffic is tracked under MASTER_USAGE_ID so the usage dashboard
 * sees everything.
 */
export function recordUsage(entry: RecordUsageInput): void {
  const db = getDb();
  const date = today();
  const isError = entry.status_code >= 400 ? 1 : 0;
  const promptTokens = entry.prompt_tokens || 0;
  const completionTokens = entry.completion_tokens || 0;
  const cost = estimateCost(entry.model, promptTokens, completionTokens).cost_usd;

  // '' is the sentinel for groupless traffic. NULL cannot be used in the
  // usage_daily primary key: SQLite treats each NULL as distinct, which would
  // fork a new row for every groupless request (404s, video polls, etc).
  const groupId = entry.group_id || '';

  db.prepare(`
    INSERT INTO usage_daily (date, client_key_id, group_id, model, requests, errors, prompt_tokens, completion_tokens, cost_usd)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
    ON CONFLICT(date, client_key_id, group_id, model) DO UPDATE SET
      requests = requests + 1,
      errors = errors + ?,
      prompt_tokens = prompt_tokens + ?,
      completion_tokens = completion_tokens + ?,
      cost_usd = cost_usd + ?
  `).run(
    date,
    entry.client_key_id,
    groupId,
    entry.model,
    isError,
    promptTokens,
    completionTokens,
    cost,
    isError,
    promptTokens,
    completionTokens,
    cost,
  );

  if (entry.client_key_id !== MASTER_USAGE_ID) {
    const tokens = promptTokens + completionTokens;
    db.prepare(`
      UPDATE client_keys SET
        total_requests = total_requests + 1,
        total_tokens = total_tokens + ?,
        total_cost_usd = total_cost_usd + ?,
        last_used_at = datetime('now')
      WHERE id = ?
    `).run(tokens, cost, entry.client_key_id);
  }
}

function mapRow(row: any): ClientKey {
  return {
    id: row.id,
    name: row.name,
    key_hash: row.key_hash,
    key_prefix: row.key_prefix,
    enabled: row.enabled === 1,
    rpm_limit: row.rpm_limit ?? null,
    daily_request_limit: row.daily_request_limit ?? null,
    daily_token_budget: row.daily_token_budget ?? null,
    allowed_group_ids: JSON.parse(row.allowed_group_ids || "[]"),
    total_requests: row.total_requests,
    total_tokens: row.total_tokens,
    total_cost_usd: row.total_cost_usd,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
