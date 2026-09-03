/**
 * Usage analytics — daily rollups, per-model/group/client-key breakdowns,
 * and the savings meter (estimated spend avoided by farming free trials).
 *
 * Rows are written by client-key-store.recordUsage(); cost is estimated via
 * the pricing catalog at write time, so these reads are cheap.
 */

import { getDb } from "./database.js";
import { MASTER_USAGE_ID } from "./client-key-store.js";

export interface UsageTotals {
  requests: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export interface UsageByModel {
  model: string;
  requests: number;
  tokens: number;
  cost_usd: number;
}

export interface UsageByClient {
  client_key_id: string;
  name: string;
  requests: number;
  errors: number;
  tokens: number;
  cost_usd: number;
}

export interface UsageDailyPoint {
  date: string;
  requests: number;
  errors: number;
  tokens: number;
  cost_usd: number;
}

export interface UsageSummary {
  range_days: number;
  totals: UsageTotals;
  by_model: UsageByModel[];
  by_group: Array<{ group_id: string; requests: number; tokens: number; cost_usd: number }>;
  by_client: UsageByClient[];
}

function sinceClause(days: number): { clause: string; params: unknown[] } {
  return { clause: "date >= date('now', ?)", params: [`-${days} days`] };
}

export function getUsageSummary(days = 30): UsageSummary {
  const db = getDb();
  const { clause, params } = sinceClause(days);

  const totalsRow = db
    .prepare(
      `SELECT COALESCE(SUM(requests),0) requests, COALESCE(SUM(errors),0) errors,
              COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens,
              COALESCE(SUM(cost_usd),0) cost_usd
       FROM usage_daily WHERE ${clause}`,
    )
    .get(...params) as any;

  const byModel = (
    db
      .prepare(
        `SELECT model, SUM(requests) requests, SUM(prompt_tokens + completion_tokens) tokens, SUM(cost_usd) cost_usd
         FROM usage_daily WHERE ${clause} GROUP BY model ORDER BY cost_usd DESC LIMIT 25`,
      )
      .all(...params) as any[]
  ).map((r) => ({
    model: r.model,
    requests: r.requests,
    tokens: r.tokens,
    cost_usd: round6(r.cost_usd),
  }));

  const byGroup = (
    db
      .prepare(
        `SELECT group_id, SUM(requests) requests, SUM(prompt_tokens + completion_tokens) tokens, SUM(cost_usd) cost_usd
         FROM usage_daily WHERE ${clause} AND group_id IS NOT NULL AND group_id != ''
         GROUP BY group_id ORDER BY cost_usd DESC LIMIT 25`,
      )
      .all(...params) as any[]
  ).map((r) => ({
    group_id: r.group_id,
    requests: r.requests,
    tokens: r.tokens,
    cost_usd: round6(r.cost_usd),
  }));

  const keyNames = new Map<string, string>();
  for (const row of db.prepare("SELECT id, name FROM client_keys").all() as any[]) {
    keyNames.set(row.id, row.name);
  }

  const byClient = (
    db
      .prepare(
        `SELECT client_key_id, SUM(requests) requests, SUM(errors) errors,
                SUM(prompt_tokens + completion_tokens) tokens, SUM(cost_usd) cost_usd
         FROM usage_daily WHERE ${clause} GROUP BY client_key_id ORDER BY cost_usd DESC`,
      )
      .all(...params) as any[]
  ).map((r) => ({
    client_key_id: r.client_key_id,
    name: r.client_key_id === MASTER_USAGE_ID ? "Master key" : keyNames.get(r.client_key_id) || r.client_key_id,
    requests: r.requests,
    errors: r.errors,
    tokens: r.tokens,
    cost_usd: round6(r.cost_usd),
  }));

  return {
    range_days: days,
    totals: {
      requests: totalsRow.requests,
      errors: totalsRow.errors,
      prompt_tokens: totalsRow.prompt_tokens,
      completion_tokens: totalsRow.completion_tokens,
      cost_usd: round6(totalsRow.cost_usd),
    },
    by_model: byModel,
    by_group: byGroup,
    by_client: byClient,
  };
}

export function getUsageDaily(days = 30): UsageDailyPoint[] {
  const db = getDb();
  const { clause, params } = sinceClause(days);
  const rows = db
    .prepare(
      `SELECT date, SUM(requests) requests, SUM(errors) errors,
              SUM(prompt_tokens + completion_tokens) tokens, SUM(cost_usd) cost_usd
       FROM usage_daily WHERE ${clause} GROUP BY date ORDER BY date ASC`,
    )
    .all(...params) as any[];
  return rows.map((r) => ({
    date: r.date,
    requests: r.requests,
    errors: r.errors,
    tokens: r.tokens,
    cost_usd: round6(r.cost_usd),
  }));
}

export interface SavingsReport {
  free_tokens: number;
  free_calls: number;
  estimated_spend_avoided_usd: number;
  all_time: UsageTotals;
}

/** All-time savings: every proxied token ran on free-trial quota. */
export function getSavings(): SavingsReport {
  const db = getDb();
  const all = db
    .prepare(
      `SELECT COALESCE(SUM(requests),0) requests, COALESCE(SUM(errors),0) errors,
              COALESCE(SUM(prompt_tokens),0) prompt_tokens, COALESCE(SUM(completion_tokens),0) completion_tokens,
              COALESCE(SUM(cost_usd),0) cost_usd
       FROM usage_daily`,
    )
    .get() as any;

  const calls = (
    db.prepare("SELECT COALESCE(SUM(requests),0) c FROM usage_daily").get() as any
  ).c;

  return {
    free_tokens: all.prompt_tokens + all.completion_tokens,
    free_calls: calls,
    estimated_spend_avoided_usd: round6(all.cost_usd),
    all_time: {
      requests: all.requests,
      errors: all.errors,
      prompt_tokens: all.prompt_tokens,
      completion_tokens: all.completion_tokens,
      cost_usd: round6(all.cost_usd),
    },
  };
}

function round6(n: number): number {
  return Math.round((n || 0) * 1e6) / 1e6;
}
