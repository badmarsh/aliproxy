export type KeyType = "standard" | "coding_plan" | "workspace_scoped";

export type KeyStatus =
  | "active"
  | "invalid"
  | "rate_limited"
  | "quota_exhausted"
  | "disabled"
  | "unknown";

export type SelectionStrategy =
  | "round_robin"
  | "weighted"
  | "least_recently_used"
  | "first_available";

export type TelemetrySource =
  | "upstream_usage_api"
  | "response_headers"
  | "local_estimate"
  | "unknown";

export type ModelCapability = "chat" | "streaming" | "embeddings" | "vision" | "tools";

export interface ApiKey {
  id: string;
  alias: string;
  fingerprint: string;
  key_type: KeyType;
  region: string;
  workspace_id: string | null;
  base_url: string;
  status: KeyStatus;
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

export interface ApiKeyWithSecret extends ApiKey {
  secret: string;
}

export interface CandidateModel {
  upstream_model_id: string;
  priority: number;
  capabilities: ModelCapability[];
}

export interface ModelGroup {
  id: string;
  display_name: string;
  aliases: string[];
  candidates: CandidateModel[];
  key_ids: string[];
  strategy: SelectionStrategy;
  weights: Record<string, number>;
  fallback_group_ids: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuotaSnapshot {
  id: string;
  api_key_id: string;
  upstream_model_id: string | null;
  rpm_limit: number | null;
  rpm_remaining: number | null;
  tpm_limit: number | null;
  tpm_remaining: number | null;
  daily_limit: number | null;
  daily_remaining: number | null;
  source: TelemetrySource;
  observed_at: string;
  expires_at: string | null;
}

export interface RequestLog {
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

export interface UpstreamError {
  status: number;
  code: string;
  message: string;
  classifiedStatus: KeyStatus;
}

export interface RateLimitHints {
  rpmLimit: number | null;
  rpmRemaining: number | null;
  rpmReset: number | null;
}

export interface NormalizedChatRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  stream: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: unknown[];
  [key: string]: unknown;
}

export interface NormalizedEmbeddingRequest {
  model: string;
  input: string | string[];
  dimensions?: number;
  [key: string]: unknown;
}

export interface CsvKeyRecord {
  id: string;
  apiKey: string;
  apiHost: string;
  openAiCompatible: string;
  dashScope: string;
  description: string;
  workspaceName: string;
  workspaceId: string;
}
