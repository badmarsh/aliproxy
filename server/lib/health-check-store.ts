import { getDb } from "./database.js";
import { generateId } from "./ids.js";
import { createLogger } from "./logger.js";

const log = createLogger("health-check-store");

export interface HealthCheck {
  id: string;
  api_key_id: string;
  upstream_model_id: string;
  success: boolean;
  status_code: number | null;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  checked_at: string;
}

export interface HealthCheckSummary {
  api_key_id: string;
  total: number;
  passed: number;
  failed: number;
  last_check_at: string | null;
  models_tested: string[];
}

export function recordHealthCheck(input: {
  api_key_id: string;
  upstream_model_id: string;
  success: boolean;
  status_code?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  latency_ms?: number | null;
}): HealthCheck {
  const db = getDb();
  const id = generateId("hc");

  db.prepare(`
    INSERT INTO health_checks (id, api_key_id, upstream_model_id, success, status_code, error_code, error_message, latency_ms, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id,
    input.api_key_id,
    input.upstream_model_id,
    input.success ? 1 : 0,
    input.status_code ?? null,
    input.error_code ?? null,
    input.error_message ?? null,
    input.latency_ms ?? null,
  );

  return {
    id,
    api_key_id: input.api_key_id,
    upstream_model_id: input.upstream_model_id,
    success: input.success,
    status_code: input.status_code ?? null,
    error_code: input.error_code ?? null,
    error_message: input.error_message ?? null,
    latency_ms: input.latency_ms ?? null,
    checked_at: new Date().toISOString(),
  };
}

export function getRecentHealthChecks(limit: number = 100): HealthCheck[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM health_checks ORDER BY checked_at DESC LIMIT ?
  `).all(limit) as any[];

  return rows.map(mapRow);
}

export function getHealthChecksBykey(apiKeyId: string, limit: number = 50): HealthCheck[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM health_checks WHERE api_key_id = ? ORDER BY checked_at DESC LIMIT ?
  `).all(apiKeyId, limit) as any[];

  return rows.map(mapRow);
}

export function getHealthSummary(): HealthCheckSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      api_key_id,
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed,
      MAX(checked_at) as last_check_at,
      GROUP_CONCAT(DISTINCT upstream_model_id) as models_tested
    FROM health_checks
    GROUP BY api_key_id
    ORDER BY last_check_at DESC
  `).all() as any[];

  return rows.map((r) => ({
    api_key_id: r.api_key_id,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    last_check_at: r.last_check_at,
    models_tested: r.models_tested ? r.models_tested.split(",") : [],
  }));
}

export function getLastCheckPerKey(): Map<string, { checked_at: string; success: boolean }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT api_key_id, checked_at, success
    FROM health_checks
    WHERE id IN (
      SELECT MAX(id) FROM health_checks GROUP BY api_key_id
    )
  `).all() as any[];

  const map = new Map<string, { checked_at: string; success: boolean }>();
  for (const r of rows) {
    map.set(r.api_key_id, { checked_at: r.checked_at, success: r.success === 1 });
  }
  return map;
}

export function purgeOldHealthChecks(keepDays: number = 7): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM health_checks WHERE checked_at < datetime('now', '-' || ? || ' days')
  `).run(keepDays);
  if (result.changes > 0) {
    log.info("Purged old health checks", { count: result.changes, keepDays });
  }
  return result.changes;
}

function mapRow(row: any): HealthCheck {
  return {
    id: row.id,
    api_key_id: row.api_key_id,
    upstream_model_id: row.upstream_model_id,
    success: row.success === 1,
    status_code: row.status_code,
    error_code: row.error_code,
    error_message: row.error_message,
    latency_ms: row.latency_ms,
    checked_at: row.checked_at,
  };
}
