import { getDb } from "./database.js";
import { createLogger } from "./logger.js";

const log = createLogger("model-availability");

export interface ModelAvailability {
  api_key_id: string;
  upstream_model_id: string;
  available: boolean;
  error_code: string | null;
  error_message: string | null;
  last_checked_at: string;
}

/**
 * Check if a specific key+model combo is available.
 * Returns true if available or unknown (never checked).
 */
export function isModelAvailable(apiKeyId: string, upstreamModelId: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT available FROM model_availability
    WHERE api_key_id = ? AND upstream_model_id = ?
  `).get(apiKeyId, upstreamModelId) as any;

  if (!row) return true; // unknown = assume available
  return row.available === 1;
}

/**
 * Mark a key+model combo as unavailable (quota exhausted, unpurchased, etc).
 */
export function markModelUnavailable(
  apiKeyId: string,
  upstreamModelId: string,
  errorCode: string,
  errorMessage: string,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO model_availability (api_key_id, upstream_model_id, available, error_code, error_message, last_checked_at)
    VALUES (?, ?, 0, ?, ?, datetime('now'))
    ON CONFLICT(api_key_id, upstream_model_id) DO UPDATE SET
      available = 0,
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      last_checked_at = datetime('now')
  `).run(apiKeyId, upstreamModelId, errorCode, errorMessage);

  log.info("Model marked unavailable", { apiKeyId, upstreamModelId, errorCode });
}

/**
 * Mark a key+model combo as available (recovered, or confirmed working).
 */
export function markModelAvailable(apiKeyId: string, upstreamModelId: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO model_availability (api_key_id, upstream_model_id, available, error_code, error_message, last_checked_at)
    VALUES (?, ?, 1, NULL, NULL, datetime('now'))
    ON CONFLICT(api_key_id, upstream_model_id) DO UPDATE SET
      available = 1,
      error_code = NULL,
      error_message = NULL,
      last_checked_at = datetime('now')
  `).run(apiKeyId, upstreamModelId);
}

/**
 * Get all unavailable models for a key.
 */
export function getUnavailableModels(apiKeyId: string): ModelAvailability[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM model_availability
    WHERE api_key_id = ? AND available = 0
  `).all(apiKeyId) as any[];

  return rows.map((r) => ({
    api_key_id: r.api_key_id,
    upstream_model_id: r.upstream_model_id,
    available: r.available === 1,
    error_code: r.error_code,
    error_message: r.error_message,
    last_checked_at: r.last_checked_at,
  }));
}

/**
 * Get availability status for all models across all keys.
 */
export function getAllModelAvailability(): ModelAvailability[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM model_availability ORDER BY last_checked_at DESC
  `).all() as any[];

  return rows.map((r) => ({
    api_key_id: r.api_key_id,
    upstream_model_id: r.upstream_model_id,
    available: r.available === 1,
    error_code: r.error_code,
    error_message: r.error_message,
    last_checked_at: r.last_checked_at,
  }));
}

/**
 * Reset all availability for a key (e.g., after manual refresh).
 */
export function resetKeyAvailability(apiKeyId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM model_availability WHERE api_key_id = ?").run(apiKeyId);
  log.info("Reset model availability for key", { apiKeyId });
}

/**
 * Count unavailable models per key.
 */
export function getUnavailableCountBykey(): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT api_key_id, COUNT(*) as count FROM model_availability
    WHERE available = 0
    GROUP BY api_key_id
  `).all() as any[];

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.api_key_id] = row.count;
  }
  return result;
}
