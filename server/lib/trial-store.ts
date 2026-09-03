/**
 * Trial quota store — the heart of the Trial Farm.
 *
 * Tracks free-trial quota per upstream key × model:
 *   - seeded from provider presets when a key is added
 *   - decremented locally as traffic routes through (tokens for LLMs,
 *     calls for image/video models)
 *   - manually adjustable from the dashboard (source="manual")
 *
 * Routing consults trialExhausted() to skip keys whose trial for a model is
 * spent, so the pool drains evenly and no single key gets burned first.
 */

import { getDb } from "./database.js";
import { presetsForProvider } from "./trial-presets.js";
import { guessProvider } from "./providers.js";

export type TrialKind = "tokens" | "calls";

export interface TrialQuota {
  api_key_id: string;
  model: string;
  kind: TrialKind;
  limit_amount: number;
  used: number;
  remaining: number;
  expires_at: string | null;
  expired: boolean;
  exhausted: boolean;
  source: string;
  updated_at: string;
}

function expiryDate(windowDays: number | null): string | null {
  if (!windowDays) return null;
  const d = new Date();
  d.setDate(d.getDate() + windowDays);
  return d.toISOString();
}

/** Seed trial rows for a key from provider presets. Existing rows are kept. */
export function seedTrialsForKey(apiKeyId: string, baseUrl: string): number {
  const db = getDb();
  const provider = guessProvider(baseUrl);
  if (!provider) return 0;

  const presets = presetsForProvider(provider);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO trial_quotas (api_key_id, model, kind, limit_amount, used, expires_at, source)
    VALUES (?, ?, ?, ?, 0, ?, 'preset')
  `);

  let seeded = 0;
  for (const preset of presets) {
    const result = insert.run(apiKeyId, preset.model, preset.kind, preset.amount, expiryDate(preset.window_days));
    if (result.changes > 0) seeded++;
  }
  return seeded;
}

/** Seed trials for every key that has none yet (used by sweeps). */
export function seedAllMissingTrials(): { keys_touched: number; rows_seeded: number } {
  const db = getDb();
  const keys = db.prepare("SELECT id, base_url FROM api_keys").all() as any[];
  let keysTouched = 0;
  let rowsSeeded = 0;
  for (const key of keys) {
    const seeded = seedTrialsForKey(key.id, key.base_url);
    if (seeded > 0) {
      keysTouched++;
      rowsSeeded += seeded;
    }
  }
  return { keys_touched: keysTouched, rows_seeded: rowsSeeded };
}

function rowToQuota(row: any): TrialQuota {
  const expired = !!row.expires_at && new Date(row.expires_at).getTime() <= Date.now();
  const remaining = Math.max(0, row.limit_amount - row.used);
  return {
    api_key_id: row.api_key_id,
    model: row.model,
    kind: row.kind as TrialKind,
    limit_amount: row.limit_amount,
    used: row.used,
    remaining,
    expires_at: row.expires_at,
    expired,
    exhausted: expired || remaining <= 0,
    source: row.source,
    updated_at: row.updated_at,
  };
}

export function getTrialQuota(apiKeyId: string, model: string): TrialQuota | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM trial_quotas WHERE api_key_id = ? AND model = ?")
    .get(apiKeyId, model) as any;
  return row ? rowToQuota(row) : null;
}

/** True when a trial row exists and is spent or expired. No row = untracked (not exhausted). */
export function trialExhausted(apiKeyId: string, model: string): boolean {
  const quota = getTrialQuota(apiKeyId, model);
  return quota !== null && quota.exhausted;
}

export function consumeTrialTokens(apiKeyId: string, model: string, tokens: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE trial_quotas SET used = used + ?, updated_at = datetime('now') WHERE api_key_id = ? AND model = ?",
  ).run(Math.max(0, tokens), apiKeyId, model);
}

export function consumeTrialCall(apiKeyId: string, model: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE trial_quotas SET used = used + 1, updated_at = datetime('now') WHERE api_key_id = ? AND model = ?",
  ).run(apiKeyId, model);
}

/**
 * Mark a trial as fully spent — used when the upstream reports the free
 * quota is gone (412/429 quota errors on trial keys). No-op without a row.
 */
export function burnTrial(apiKeyId: string, model: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE trial_quotas SET used = limit_amount, updated_at = datetime('now') WHERE api_key_id = ? AND model = ?",
  ).run(apiKeyId, model);
}

/** Manual upsert — override any preset with your real quota numbers. */
export function setTrialQuota(
  apiKeyId: string,
  model: string,
  kind: TrialKind,
  limitAmount: number,
  expiresAt: string | null,
): TrialQuota {
  const db = getDb();
  db.prepare(`
    INSERT INTO trial_quotas (api_key_id, model, kind, limit_amount, used, expires_at, source)
    VALUES (?, ?, ?, ?, 0, ?, 'manual')
    ON CONFLICT(api_key_id, model) DO UPDATE SET
      kind = excluded.kind,
      limit_amount = excluded.limit_amount,
      expires_at = excluded.expires_at,
      source = 'manual',
      updated_at = datetime('now')
  `).run(apiKeyId, model, kind, limitAmount, expiresAt);
  return getTrialQuota(apiKeyId, model)!;
}

export function deleteTrialQuota(apiKeyId: string, model: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM trial_quotas WHERE api_key_id = ? AND model = ?").run(apiKeyId, model);
  return result.changes > 0;
}

export interface RadarKeyCell {
  key_id: string;
  alias: string;
  key_status: string;
  kind: TrialKind;
  limit_amount: number;
  used: number;
  remaining: number;
  pct_used: number;
  expires_at: string | null;
  exhausted: boolean;
}

export interface RadarModelRow {
  model: string;
  kind: TrialKind;
  keys: RadarKeyCell[];
  total_remaining: number;
  total_limit: number;
  live_keys: number;
}

export interface RadarReport {
  generated_at: string;
  models: RadarModelRow[];
  totals: {
    models_tracked: number;
    keys_tracked: number;
    free_tokens_remaining: number;
    free_calls_remaining: number;
    exhausted_rows: number;
    expiring_rows: number;
  };
}

/** Full model × key matrix of remaining free quota. Powers the dashboard radar. */
export function getTrialRadar(): RadarReport {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT t.*, a.alias, a.status as key_status
      FROM trial_quotas t
      JOIN api_keys a ON a.id = t.api_key_id
      ORDER BY t.model ASC, a.alias ASC
    `)
    .all() as any[];

  const byModel = new Map<string, RadarModelRow>();
  const keyIds = new Set<string>();
  let freeTokens = 0;
  let freeCalls = 0;
  let exhaustedRows = 0;
  let expiringRows = 0;
  const soon = Date.now() + 7 * 24 * 3600 * 1000;

  for (const row of rows) {
    const quota = rowToQuota(row);
    keyIds.add(quota.api_key_id);
    if (quota.expired || (quota.expires_at && new Date(quota.expires_at).getTime() <= soon)) expiringRows++;
    if (quota.exhausted) exhaustedRows++;

    const cell: RadarKeyCell = {
      key_id: quota.api_key_id,
      alias: row.alias,
      key_status: row.key_status,
      kind: quota.kind,
      limit_amount: quota.limit_amount,
      used: quota.used,
      remaining: quota.remaining,
      pct_used: quota.limit_amount > 0 ? Math.min(100, Math.round((quota.used / quota.limit_amount) * 100)) : 100,
      expires_at: quota.expires_at,
      exhausted: quota.exhausted,
    };

    let modelRow = byModel.get(quota.model);
    if (!modelRow) {
      modelRow = {
        model: quota.model,
        kind: quota.kind,
        keys: [],
        total_remaining: 0,
        total_limit: 0,
        live_keys: 0,
      };
      byModel.set(quota.model, modelRow);
    }
    modelRow.keys.push(cell);
    modelRow.total_remaining += quota.remaining;
    modelRow.total_limit += quota.limit_amount;
    if (!quota.exhausted) modelRow.live_keys++;

    if (quota.kind === "tokens") freeTokens += quota.remaining;
    else freeCalls += quota.remaining;
  }

  return {
    generated_at: new Date().toISOString(),
    models: Array.from(byModel.values()),
    totals: {
      models_tracked: byModel.size,
      keys_tracked: keyIds.size,
      free_tokens_remaining: freeTokens,
      free_calls_remaining: freeCalls,
      exhausted_rows: exhaustedRows,
      expiring_rows: expiringRows,
    },
  };
}

export interface TrialExpiryWarning {
  key_id: string;
  alias: string;
  model: string;
  expires_at: string;
  days_left: number;
}

/** Trials expiring within N days — burn these first! */
export function getExpiringTrials(days = 7): TrialExpiryWarning[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT t.api_key_id, t.model, t.expires_at, a.alias
      FROM trial_quotas t JOIN api_keys a ON a.id = t.api_key_id
      WHERE t.expires_at IS NOT NULL AND t.used < t.limit_amount
    `)
    .all() as any[];

  const cutoff = Date.now() + days * 24 * 3600 * 1000;
  const warnings: TrialExpiryWarning[] = [];
  for (const row of rows) {
    const expires = new Date(row.expires_at).getTime();
    if (expires <= cutoff) {
      warnings.push({
        key_id: row.api_key_id,
        alias: row.alias,
        model: row.model,
        expires_at: row.expires_at,
        days_left: Math.max(0, Math.ceil((expires - Date.now()) / (24 * 3600 * 1000))),
      });
    }
  }
  return warnings.sort((a, b) => a.expires_at.localeCompare(b.expires_at));
}
