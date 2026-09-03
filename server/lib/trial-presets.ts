/**
 * Free-trial presets — what providers hand out to fresh accounts.
 *
 * DashScope famously gives ~1M free tokens per LLM for new accounts, plus
 * trial quotas for image/video models. Exact offers vary by region and
 * promotion, so everything here is a *default estimate* you can override:
 *
 *   - Point TRIAL_PRESETS_PATH at a JSON file with the same shape
 *   - Or edit quotas per key/model from the dashboard (source="manual")
 *
 * Shape of a preset:
 *   model        upstream model id (exact match or '*' for a catch-all)
 *   kind         "tokens" (LLMs/embeddings) or "calls" (image/video APIs)
 *   amount       free amount granted
 *   window_days  trial window in days (null = until used up)
 */

export interface TrialPreset {
  model: string;
  kind: "tokens" | "calls";
  amount: number;
  window_days: number | null;
}

interface ProviderTrials {
  provider: string;
  trials: TrialPreset[];
}

const DEFAULTS: ProviderTrials[] = [
  {
    provider: "dashscope-intl",
    trials: [
      // Flagship LLMs — ~1M tokens each
      { model: "qwen3.8-max", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3.7-max", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3-max", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3.8-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3.7-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3.7-flash", kind: "tokens", amount: 2_000_000, window_days: 180 },
      { model: "qwen3.7-turbo", kind: "tokens", amount: 2_000_000, window_days: 180 },
      { model: "qwen3-coder-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3-vl-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen-vl-max", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen-vl-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "text-embedding-v4", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "text-embedding-v3", kind: "tokens", amount: 1_000_000, window_days: 180 },
      // Multimodal trials — call-based
      { model: "wanx2.1-t2i-turbo", kind: "calls", amount: 500, window_days: 180 },
      { model: "wanx2.1-t2i-plus", kind: "calls", amount: 500, window_days: 180 },
      { model: "wan2.2-t2i-flash", kind: "calls", amount: 500, window_days: 180 },
      { model: "wan2.5-t2v-preview", kind: "calls", amount: 20, window_days: 90 },
      { model: "wan2.2-t2v-plus", kind: "calls", amount: 20, window_days: 90 },
      { model: "wan2.1-t2v-turbo", kind: "calls", amount: 20, window_days: 90 },
    ],
  },
  {
    provider: "dashscope-cn",
    trials: [
      { model: "qwen3.8-max", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3.8-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3.7-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "qwen3.7-flash", kind: "tokens", amount: 2_000_000, window_days: 180 },
      { model: "qwen3-coder-plus", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "text-embedding-v4", kind: "tokens", amount: 1_000_000, window_days: 180 },
      { model: "wanx2.1-t2i-turbo", kind: "calls", amount: 500, window_days: 180 },
      { model: "wan2.2-t2i-flash", kind: "calls", amount: 500, window_days: 180 },
      { model: "wan2.5-t2v-preview", kind: "calls", amount: 20, window_days: 90 },
      { model: "wan2.1-t2v-turbo", kind: "calls", amount: 20, window_days: 90 },
    ],
  },
  {
    provider: "deepseek",
    trials: [
      { model: "deepseek-chat", kind: "tokens", amount: 5_000_000, window_days: 30 },
      { model: "deepseek-reasoner", kind: "tokens", amount: 5_000_000, window_days: 30 },
    ],
  },
  {
    provider: "groq",
    trials: [
      // Groq free tier is rate-limited rather than quota-limited; tracked as calls/day-ish
      { model: "llama-3.3-70b-versatile", kind: "calls", amount: 14_400, window_days: null },
    ],
  },
  {
    // Echo mock provider — unlimited, so no trial rows. Listed for discoverability.
    provider: "echo",
    trials: [],
  },
];

import { readFileSync, existsSync } from "node:fs";

let cached: ProviderTrials[] | null = null;

export function getTrialPresets(): ProviderTrials[] {
  if (cached) return cached;
  const path = process.env.TRIAL_PRESETS_PATH;
  if (path && existsSync(path)) {
    try {
      cached = JSON.parse(readFileSync(path, "utf-8")) as ProviderTrials[];
      return cached;
    } catch {
      // fall through to defaults on malformed overrides
    }
  }
  cached = DEFAULTS;
  return cached;
}

export function presetsForProvider(providerId: string): TrialPreset[] {
  return getTrialPresets().find((p) => p.provider === providerId)?.trials || [];
}

export function listPresetProviders(): ProviderTrials[] {
  return getTrialPresets();
}
