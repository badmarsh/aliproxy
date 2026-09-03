import { getDb } from "./database.js";
import { generateId } from "./ids.js";
import { config } from "./config.js";
import type { RequestLog } from "./types.js";

export interface LogEntry {
  request_id: string;
  timestamp: string;
  client_ip: string | null;
  requested_model: string;
  resolved_group_id: string | null;
  upstream_model_id: string | null;
  api_key_id: string | null;
  status_code: number;
  error_code: string | null;
  latency_ms: number;
  ttft_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  streaming: boolean;
  retry_count: number;
}

export function logRequest(entry: LogEntry): void {
  const db = getDb();
  const id = generateId("log");

  db.prepare(`
    INSERT INTO request_logs (
      id, request_id, timestamp, client_ip, requested_model,
      resolved_group_id, upstream_model_id, api_key_id,
      status_code, error_code, latency_ms, ttft_ms,
      prompt_tokens, completion_tokens, streaming, retry_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_id) DO NOTHING
  `).run(
    id,
    entry.request_id,
    entry.timestamp,
    entry.client_ip,
    entry.requested_model,
    entry.resolved_group_id,
    entry.upstream_model_id,
    entry.api_key_id,
    entry.status_code,
    entry.error_code,
    entry.latency_ms,
    entry.ttft_ms,
    entry.prompt_tokens,
    entry.completion_tokens,
    entry.streaming ? 1 : 0,
    entry.retry_count,
  );

  const count = db.prepare("SELECT COUNT(*) as count FROM request_logs").get() as any;
  if (count.count > config.logging.maxRequestLogCount) {
    const excess = count.count - config.logging.maxRequestLogCount;
    db.prepare(`
      DELETE FROM request_logs WHERE id IN (
        SELECT id FROM request_logs ORDER BY timestamp ASC LIMIT ?
      )
    `).run(excess);
  }
}

export function getRecentLogs(limit: number = 50, groupId?: string): RequestLog[] {
  const db = getDb();
  let query = "SELECT * FROM request_logs";
  const params: unknown[] = [];

  if (groupId) {
    query += " WHERE resolved_group_id = ?";
    params.push(groupId);
  }

  query += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(mapRowToLog);
}

export function getStats(): {
  total_requests: number;
  requests_last_hour: number;
  avg_latency_ms: number;
  groups: Record<string, { requests: number; avg_latency_ms: number }>;
} {
  const db = getDb();

  const total = (db.prepare("SELECT COUNT(*) as count FROM request_logs").get() as any).count;

  const lastHour = (db
    .prepare("SELECT COUNT(*) as count FROM request_logs WHERE timestamp > datetime('now', '-1 hour')")
    .get() as any).count;

  const avgLatency = (db
    .prepare("SELECT AVG(latency_ms) as avg FROM request_logs")
    .get() as any).avg || 0;

  const groupStats = db
    .prepare(`
      SELECT resolved_group_id, COUNT(*) as requests, AVG(latency_ms) as avg_latency
      FROM request_logs
      WHERE resolved_group_id IS NOT NULL
      GROUP BY resolved_group_id
    `)
    .all() as any[];

  const groups: Record<string, { requests: number; avg_latency_ms: number }> = {};
  for (const row of groupStats) {
    groups[row.resolved_group_id] = {
      requests: row.requests,
      avg_latency_ms: Math.round(row.avg_latency || 0),
    };
  }

  return {
    total_requests: total,
    requests_last_hour: lastHour,
    avg_latency_ms: Math.round(avgLatency),
    groups,
  };
}

export function getTimeline(hours: number = 24): Array<{
  hour: string;
  requests: number;
  errors: number;
  avg_latency_ms: number;
}> {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', timestamp) as hour,
        COUNT(*) as requests,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors,
        AVG(latency_ms) as avg_latency
      FROM request_logs
      WHERE timestamp > datetime('now', ?)
      GROUP BY hour
      ORDER BY hour ASC
    `)
    .all(`-${hours} hours`) as any[];

  return rows.map((row) => ({
    hour: row.hour,
    requests: row.requests,
    errors: row.errors,
    avg_latency_ms: Math.round(row.avg_latency || 0),
  }));
}

function mapRowToLog(row: any): RequestLog {
  return {
    id: row.id,
    request_id: row.request_id,
    timestamp: row.timestamp,
    client_ip: row.client_ip,
    requested_model: row.requested_model,
    resolved_group_id: row.resolved_group_id,
    upstream_model_id: row.upstream_model_id,
    api_key_id: row.api_key_id,
    status_code: row.status_code,
    error_code: row.error_code,
    latency_ms: row.latency_ms,
    ttft_ms: row.ttft_ms,
    prompt_tokens: row.prompt_tokens,
    completion_tokens: row.completion_tokens,
    streaming: row.streaming === 1,
    retry_count: row.retry_count,
  };
}
