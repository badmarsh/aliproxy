/**
 * Upstream provider presets.
 *
 * Aliproxy speaks the OpenAI-compatible protocol to any upstream that
 * implements it. These presets drive the "Add Key" flow in the dashboard and
 * give every key a sensible default base URL + region.
 *
 * The special `echo` provider is a built-in mock upstream: it answers with
 * synthetic completions and never touches the network. Use it to test
 * integrations, routing, and client keys without real credentials.
 */

export interface ProviderPreset {
  id: string;
  label: string;
  base_url: string;
  region: string;
  key_hint: string;
  built_in?: boolean;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: "dashscope-intl",
    label: "Aliyun DashScope (International)",
    base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    region: "ap-southeast-1",
    key_hint: "sk-…",
  },
  {
    id: "dashscope-cn",
    label: "Aliyun DashScope (China)",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    region: "cn-beijing",
    key_hint: "sk-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    region: "global",
    key_hint: "sk-proj-…",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    region: "cn-hangzhou",
    key_hint: "sk-…",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    region: "global",
    key_hint: "sk-or-…",
  },
  {
    id: "groq",
    label: "Groq",
    base_url: "https://api.groq.com/openai/v1",
    region: "global",
    key_hint: "gsk_…",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    base_url: "https://api.mistral.ai/v1",
    region: "global",
    key_hint: "…",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    base_url: "http://127.0.0.1:11434/v1",
    region: "local",
    key_hint: "ollama (any value)",
  },
  {
    id: "vllm",
    label: "vLLM / other OpenAI-compatible",
    base_url: "http://127.0.0.1:8000/v1",
    region: "local",
    key_hint: "any",
  },
  {
    id: "echo",
    label: "Aliproxy Echo (built-in mock)",
    base_url: "echo://local",
    region: "local",
    key_hint: "echo (any value)",
    built_in: true,
  },
];

export function getProvider(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Guess a provider id from a base URL (best effort, for UI display). */
export function guessProvider(baseUrl: string): string | null {
  const url = (baseUrl || "").toLowerCase();
  if (url.startsWith("echo://")) return "echo";
  for (const p of PROVIDERS) {
    if (p.built_in) continue;
    if (url.startsWith(p.base_url.toLowerCase().replace(/\/v1$/, ""))) return p.id;
  }
  return null;
}
