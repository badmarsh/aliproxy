/**
 * API client for Qwen Proxy Dashboard.
 * Connects to the local Qwen Proxy Admin & Health API.
 */

const BASE_URL = process.env.NEXT_PUBLIC_PROXY_API_URL || "http://127.0.0.1:8080";
const API_KEY = process.env.NEXT_PUBLIC_PROXY_API_KEY || "qwen-proxy-local-key";

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
  capabilities: ("chat" | "streaming" | "embeddings" | "vision" | "tools")[];
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
