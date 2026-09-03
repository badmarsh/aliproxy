/**
 * API client for Aliproxy 2026 — Ultimate Proxy Suite (Trial Farm edition).
 * Talks same-origin to the Aliproxy server (Next.js rewrites /api/* to it).
 * Set NEXT_PUBLIC_PROXY_API_URL for a split deployment instead.
 */

const BASE_URL = process.env.NEXT_PUBLIC_PROXY_API_URL || "";
const API_KEY = process.env.NEXT_PUBLIC_PROXY_API_KEY || "aliproxy-local-key";

function getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
    ...customHeaders,
  };
}

export interface ApiKeyItem {
  id: string;
  alias: string;
  fingerprint: string;
  key_type: "standard" | "coding_plan" | "workspace_scoped";
  region: string;
  workspace_id: string | null;
  base_url: string;
  status: "active" | "invalid" | "rate_limited" | "quota_exhausted" | "disabled" | "unknown";
  enabled: boolean;
  cooldown_until: string | null;
  last_validated_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  consecutive_failures: number;
  groups: string[];
  created_at: string;
  updated_at: string;
}

export interface CandidateModelItem {
  upstream_model_id: string;
  priority: number;
  capabilities: ("chat" | "streaming" | "embeddings" | "vision" | "tools" | "images" | "video")[];
}

export interface ModelGroupItem {
  id: string;
  display_name: string;
  aliases: string[];
  candidates: CandidateModelItem[];
  key_ids: string[];
  strategy: "round_robin" | "weighted" | "least_recently_used" | "first_available";
  weights: Record<string, number>;
  fallback_group_ids: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface StatsSummary {
  total_requests: number;
  requests_last_hour: number;
  avg_latency_ms: number;
  groups: Record<string, { requests: number; avg_latency_ms: number }>;
}

export interface TimelinePoint {
  hour: string;
  requests: number;
  errors: number;
  avg_latency_ms: number;
}

export interface RequestLogItem {
  id: string;
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

export async function fetchKeys(): Promise<ApiKeyItem[]> {
  const res = await fetch(`${BASE_URL}/api/keys`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch keys: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

export async function createKey(data: {
  alias: string;
  secret: string;
  key_type?: string;
  region?: string;
  workspace_id?: string | null;
  base_url: string;
  groups?: string[];
}): Promise<ApiKeyItem> {
  const res = await fetch(`${BASE_URL}/api/keys`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || "Failed to create key");
  }
  const json = await res.json();
  return json.data;
}

export async function updateKey(id: string, data: Partial<ApiKeyItem>): Promise<ApiKeyItem> {
  const res = await fetch(`${BASE_URL}/api/keys/${id}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update key: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function deleteKey(id: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/keys/${id}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  return res.ok;
}

export async function testKey(id: string): Promise<{ success: boolean; latency_ms?: number; models_count?: number; error?: string; status: string }> {
  const res = await fetch(`${BASE_URL}/api/keys/${id}/test`, {
    method: "POST",
    headers: getHeaders(),
  });
  return await res.json();
}

export async function refreshKeyQuota(id: string): Promise<{ success: boolean; latency_ms?: number; models_count?: number; data?: ApiKeyItem }> {
  const res = await fetch(`${BASE_URL}/api/keys/${id}/refresh-quota`, {
    method: "POST",
    headers: getHeaders(),
  });
  return await res.json();
}

export async function fetchGroups(): Promise<ModelGroupItem[]> {
  const res = await fetch(`${BASE_URL}/api/groups`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch groups: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

export async function createGroup(data: {
  id: string;
  display_name: string;
  aliases?: string[];
  candidates?: CandidateModelItem[];
  key_ids?: string[];
  strategy?: string;
  weights?: Record<string, number>;
  fallback_group_ids?: string[];
  enabled?: boolean;
}): Promise<ModelGroupItem> {
  const res = await fetch(`${BASE_URL}/api/groups`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || "Failed to create group");
  }
  const json = await res.json();
  return json.data;
}

export async function updateGroup(id: string, data: Partial<ModelGroupItem>): Promise<ModelGroupItem> {
  const res = await fetch(`${BASE_URL}/api/groups/${id}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update group: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function deleteGroup(id: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/groups/${id}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  return res.ok;
}

export async function fetchStatsSummary(): Promise<StatsSummary> {
  const res = await fetch(`${BASE_URL}/api/stats/summary`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch summary: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function fetchStatsTimeline(hours: number = 24): Promise<TimelinePoint[]> {
  const res = await fetch(`${BASE_URL}/api/stats/timeline?hours=${hours}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch timeline: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

export async function fetchLogs(limit: number = 50, group?: string): Promise<RequestLogItem[]> {
  const url = new URL(`${BASE_URL}/api/logs`);
  url.searchParams.set("limit", String(limit));
  if (group) url.searchParams.set("group", group);

  const res = await fetch(url.toString(), { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch logs: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

export async function fetchHealth(): Promise<{ status: string; uptime_seconds: number; proxy_version: string }> {
  const res = await fetch(`${BASE_URL}/health`);
  if (!res.ok) throw new Error(`Failed to fetch health: ${res.statusText}`);
  return await res.json();
}

export async function fetchConfig(): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/config`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function updateConfig(data: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/api/config`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.statusText}`);
  return await res.json();
}

// ---------------------------------------------------------------------------
// Trial Farm — client keys, trials, usage, providers, sweep, playground
// ---------------------------------------------------------------------------

export interface ClientKeyItem {
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
  plaintext?: string; // only present at creation / rotation
  today_usage?: { requests: number; errors: number; prompt_tokens: number; completion_tokens: number; cost_usd: number };
}

export interface ProviderPresetItem {
  id: string;
  label: string;
  base_url: string;
  region: string;
  key_hint: string;
  built_in?: boolean;
}

export interface TrialRadarKeyCell {
  key_id: string;
  alias: string;
  key_status: string;
  kind: 'tokens' | 'calls';
  limit_amount: number;
  used: number;
  remaining: number;
  pct_used: number;
  expires_at: string | null;
  exhausted: boolean;
}

export interface TrialRadarModelRow {
  model: string;
  kind: 'tokens' | 'calls';
  keys: TrialRadarKeyCell[];
  total_remaining: number;
  total_limit: number;
  live_keys: number;
}

export interface TrialRadar {
  generated_at: string;
  models: TrialRadarModelRow[];
  totals: {
    models_tracked: number;
    keys_tracked: number;
    free_tokens_remaining: number;
    free_calls_remaining: number;
    exhausted_rows: number;
    expiring_rows: number;
  };
}

export interface ExpiringTrial {
  key_id: string;
  alias: string;
  model: string;
  expires_at: string;
  days_left: number;
}

export interface UsageSummaryData {
  range_days: number;
  totals: { requests: number; errors: number; prompt_tokens: number; completion_tokens: number; cost_usd: number };
  by_model: Array<{ model: string; requests: number; tokens: number; cost_usd: number }>;
  by_group: Array<{ group_id: string; requests: number; tokens: number; cost_usd: number }>;
  by_client: Array<{ client_key_id: string; name: string; requests: number; errors: number; tokens: number; cost_usd: number }>;
}

export interface UsageDailyPoint {
  date: string;
  requests: number;
  errors: number;
  tokens: number;
  cost_usd: number;
}

export interface SavingsReport {
  free_tokens: number;
  free_calls: number;
  estimated_spend_avoided_usd: number;
  all_time: { requests: number; errors: number; prompt_tokens: number; completion_tokens: number; cost_usd: number };
}

export interface SweepReport {
  swept_at: string;
  keys_checked: number;
  keys_valid: number;
  keys_failed: number;
  trials_seeded: number;
  keys: Array<{ id: string; alias: string; ok: boolean; status: string; latency_ms: number; models: number; error?: string }>;
}

export interface TrialQuotaItem {
  key_id: string;
  alias: string;
  model: string;
  kind: 'tokens' | 'calls';
  limit_amount: number;
  used: number;
  remaining: number;
  pct_used: number;
  expires_at: string | null;
  exhausted: boolean;
}

export async function fetchTimeline(hours = 24): Promise<TimelinePoint[]> {
  const res = await fetch(`${BASE_URL}/api/stats/timeline?hours=${hours}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch timeline: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

// --- Providers ---

export async function fetchProviders(): Promise<ProviderPresetItem[]> {
  const res = await fetch(`${BASE_URL}/api/providers`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch providers: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

// --- Client keys ---

export async function fetchClientKeys(): Promise<ClientKeyItem[]> {
  const res = await fetch(`${BASE_URL}/api/client-keys`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch client keys: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

export async function createClientKey(data: {
  name: string;
  rpm_limit?: number | null;
  daily_request_limit?: number | null;
  daily_token_budget?: number | null;
  allowed_group_ids?: string[];
}): Promise<ClientKeyItem> {
  const res = await fetch(`${BASE_URL}/api/client-keys`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Failed to create client key');
  }
  const json = await res.json();
  return json.data;
}

export async function updateClientKey(id: string, data: Partial<ClientKeyItem>): Promise<ClientKeyItem> {
  const res = await fetch(`${BASE_URL}/api/client-keys/${id}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update client key: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function deleteClientKey(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/client-keys/${id}`, { method: 'DELETE', headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to delete client key: ${res.statusText}`);
}

export async function rotateClientKey(id: string): Promise<ClientKeyItem> {
  const res = await fetch(`${BASE_URL}/api/client-keys/${id}/rotate`, { method: 'POST', headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to rotate client key: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

// --- Trials ---

export async function fetchTrialRadar(): Promise<TrialRadar> {
  const res = await fetch(`${BASE_URL}/api/trials/radar`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch trial radar: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function fetchExpiringTrials(days = 7): Promise<ExpiringTrial[]> {
  const res = await fetch(`${BASE_URL}/api/trials/expiring?days=${days}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch expiring trials: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

export async function reseedTrials(keyId?: string): Promise<{ keys_touched: number; rows_seeded: number }> {
  const q = keyId ? `?key_id=${encodeURIComponent(keyId)}` : '';
  const res = await fetch(`${BASE_URL}/api/trials/reseed${q}`, { method: 'POST', headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to reseed trials: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function setTrialQuota(keyId: string, model: string, data: { kind: 'tokens' | 'calls'; limit_amount: number; expires_at?: string | null }): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/trials/${encodeURIComponent(keyId)}/${encodeURIComponent(model)}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to set trial quota: ${res.statusText}`);
}

// --- Usage & savings ---

export async function fetchUsageSummary(days = 30): Promise<UsageSummaryData> {
  const res = await fetch(`${BASE_URL}/api/usage/summary?days=${days}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch usage summary: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

export async function fetchUsageDaily(days = 30): Promise<UsageDailyPoint[]> {
  const res = await fetch(`${BASE_URL}/api/usage/daily?days=${days}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch usage daily: ${res.statusText}`);
  const json = await res.json();
  return json.data || [];
}

export async function fetchSavings(): Promise<SavingsReport> {
  const res = await fetch(`${BASE_URL}/api/usage/savings`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch savings: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

// --- Key farm sweep ---

export async function sweepKeys(): Promise<SweepReport> {
  const res = await fetch(`${BASE_URL}/api/keys/sweep`, { method: 'POST', headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to sweep keys: ${res.statusText}`);
  const json = await res.json();
  return json.data;
}

// --- Playground (same-origin, admin-authed passthrough) ---

export async function playgroundChat(body: { model: string; messages: Array<{ role: string; content: string }>; stream?: boolean }): Promise<Response> {
  return fetch(`${BASE_URL}/api/proxy/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ ...body, stream: body.stream ?? true }),
  });
}
