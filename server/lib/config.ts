import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function env(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const parsed = parseInt(v, 10);
  return isNaN(parsed) ? fallback : parsed;
}

const proxyApiKey = env("PROXY_API_KEY", "aliproxy-local-key");

export const config = {
  proxy: {
    port: envInt("PROXY_PORT", 8080),
    host: env("PROXY_HOST", "127.0.0.1"),
    apiKeyHash: createHash("sha256").update(proxyApiKey).digest("hex"),
    apiKeyRaw: proxyApiKey,
    requestTimeoutSeconds: envInt("REQUEST_TIMEOUT_SECONDS", 120),
    streamIdleTimeoutSeconds: envInt("STREAM_IDLE_TIMEOUT_SECONDS", 60),
  },
  encryption: {
    key: env("ENCRYPTION_KEY", ""),
  },
  database: {
    path: env("DATABASE_PATH", "./data/aliproxy.db"),
  },
  routing: {
    defaultRegion: env("DEFAULT_REGION", "ap-southeast-1"),
    defaultGroup: env("DEFAULT_GROUP", ""),
    unknownModelPolicy: env("UNKNOWN_MODEL_POLICY", "reject") as "reject" | "default_group",
  },
  quota: {
    refreshIntervalSeconds: envInt("QUOTA_REFRESH_INTERVAL_SECONDS", 300),
    warningThreshold: parseFloat(env("QUOTA_WARNING_THRESHOLD", "0.2")),
  },
  logging: {
    requests: env("LOG_REQUESTS", "true") === "true",
    payload: env("LOG_PAYLOAD", "false") === "true",
    maxRequestLogCount: envInt("MAX_REQUEST_LOG_COUNT", 1000),
  },
  intake: {
    dir: env("INTAKE_DIR", "./incoming"),
    watch: env("INTAKE_WATCH", "true") === "true",
    autoGroups: env("INTAKE_AUTO_GROUPS", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
} as const;

export type Config = typeof config;
