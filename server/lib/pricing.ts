/**
 * Model pricing catalog — USD per 1M tokens.
 *
 * Used for cost estimation on proxied traffic. Values are matched by
 * longest-prefix against the upstream model id; anything unmatched falls back
 * to a generic estimate (configurable via PRICING_FALLBACK_PROMPT /
 * PRICING_FALLBACK_COMPLETION env vars, USD per 1M tokens).
 *
 * Last catalog review: 2026-09. Prices change often — treat totals as
 * estimates, and override with env vars if your contract differs.
 */

interface CatalogEntry {
  prefix: string;
  prompt: number;
  completion: number;
}

const CATALOG: CatalogEntry[] = [
  // --- Qwen / DashScope ---
  { prefix: "qwen3.8-max", prompt: 1.6, completion: 6.4 },
  { prefix: "qwen3.7-max", prompt: 1.6, completion: 6.4 },
  { prefix: "qwen3-max", prompt: 1.2, completion: 6.0 },
  { prefix: "qwen-max", prompt: 1.2, completion: 6.0 },
  { prefix: "qwen3.8-plus", prompt: 0.4, completion: 1.6 },
  { prefix: "qwen3.7-plus", prompt: 0.4, completion: 1.6 },
  { prefix: "qwen3-plus", prompt: 0.4, completion: 1.2 },
  { prefix: "qwen-plus", prompt: 0.4, completion: 1.2 },
  { prefix: "qwen3.7-flash", prompt: 0.09, completion: 0.32 },
  { prefix: "qwen3.7-turbo", prompt: 0.09, completion: 0.32 },
  { prefix: "qwen-turbo", prompt: 0.05, completion: 0.2 },
  { prefix: "qwen3-coder", prompt: 0.28, completion: 1.1 },
  { prefix: "qwen3-vl", prompt: 0.5, completion: 1.5 },
  { prefix: "qwen-vl-max", prompt: 0.8, completion: 2.4 },
  { prefix: "qwen-vl-plus", prompt: 0.4, completion: 1.2 },
  { prefix: "text-embedding", prompt: 0.07, completion: 0 },
  { prefix: "text-embedding-v4", prompt: 0.07, completion: 0 },
  { prefix: "text-embedding-v3", prompt: 0.05, completion: 0 },

  // --- OpenAI ---
  { prefix: "gpt-5", prompt: 1.25, completion: 10.0 },
  { prefix: "gpt-4.1", prompt: 2.5, completion: 10.0 },
  { prefix: "gpt-4o-mini", prompt: 0.15, completion: 0.6 },
  { prefix: "gpt-4o", prompt: 2.5, completion: 10.0 },
  { prefix: "gpt-4", prompt: 30.0, completion: 60.0 },
  { prefix: "o4-mini", prompt: 1.1, completion: 4.4 },
  { prefix: "text-embedding-3-large", prompt: 0.13, completion: 0 },
  { prefix: "text-embedding-3-small", prompt: 0.02, completion: 0 },

  // --- Anthropic (via compatible endpoints) ---
  { prefix: "claude-opus-4", prompt: 15.0, completion: 75.0 },
  { prefix: "claude-sonnet-4", prompt: 3.0, completion: 15.0 },
  { prefix: "claude-3-7-sonnet", prompt: 3.0, completion: 15.0 },
  { prefix: "claude-3-5-haiku", prompt: 0.8, completion: 4.0 },

  // --- DeepSeek ---
  { prefix: "deepseek-chat", prompt: 0.27, completion: 1.1 },
  { prefix: "deepseek-reasoner", prompt: 0.55, completion: 2.19 },

  // --- Google ---
  { prefix: "gemini-3-pro", prompt: 1.25, completion: 10.0 },
  { prefix: "gemini-2.5-pro", prompt: 1.25, completion: 10.0 },
  { prefix: "gemini-2.5-flash", prompt: 0.3, completion: 2.5 },

  // --- Meta / others ---
  { prefix: "llama-3.3-70b", prompt: 0.35, completion: 0.39 },
  { prefix: "llama-3.1-8b", prompt: 0.05, completion: 0.08 },
  { prefix: "mistral-large", prompt: 2.0, completion: 6.0 },
];

function fallbackRates(): { prompt: number; completion: number } {
  return {
    prompt: parseFloat(process.env.PRICING_FALLBACK_PROMPT || "0.5"),
    completion: parseFloat(process.env.PRICING_FALLBACK_COMPLETION || "1.5"),
  };
}

export interface PriceMatch {
  prompt_per_m: number;
  completion_per_m: number;
  matched_prefix: string | null;
  source: "catalog" | "fallback";
}

export function lookupPrice(modelId: string): PriceMatch {
  const model = (modelId || "").toLowerCase();
  // Longest prefix wins
  const sorted = [...CATALOG].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of sorted) {
    if (model.startsWith(entry.prefix)) {
      return {
        prompt_per_m: entry.prompt,
        completion_per_m: entry.completion,
        matched_prefix: entry.prefix,
        source: "catalog",
      };
    }
  }
  const fb = fallbackRates();
  return {
    prompt_per_m: fb.prompt,
    completion_per_m: fb.completion,
    matched_prefix: null,
    source: "fallback",
  };
}

export interface CostEstimate {
  cost_usd: number;
  prompt_per_m: number;
  completion_per_m: number;
  matched_prefix: string | null;
  source: "catalog" | "fallback";
}

export function estimateCost(
  modelId: string,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
): CostEstimate {
  const price = lookupPrice(modelId);
  const p = promptTokens || 0;
  const c = completionTokens || 0;
  const cost = (p / 1_000_000) * price.prompt_per_m + (c / 1_000_000) * price.completion_per_m;
  return {
    cost_usd: Math.round(cost * 1e6) / 1e6,
    prompt_per_m: price.prompt_per_m,
    completion_per_m: price.completion_per_m,
    matched_prefix: price.matched_prefix,
    source: price.source,
  };
}

/** The full catalog, for the admin API / dashboard. */
export function listPricing(): CatalogEntry[] {
  return [...CATALOG].sort((a, b) => a.prefix.localeCompare(b.prefix));
}
