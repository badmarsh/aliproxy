import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../lib/database.js";
import { createKey } from "../lib/secret-store.js";
import { createGroup } from "../lib/group-store.js";
import {
  seedTrialsForKey,
  getTrialQuota,
  trialExhausted,
  consumeTrialTokens,
  consumeTrialCall,
  burnTrial,
  setTrialQuota,
  getTrialRadar,
  getExpiringTrials,
} from "../lib/trial-store.js";

const DASHSCOPE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

describe("trial-store", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM trial_quotas").run();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
  });

  it("seeds preset trial rows for a DashScope key", () => {
    const key = createKey({ alias: "trial-1", secret: "sk-test-trial-1", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    const seeded = seedTrialsForKey(key.id, DASHSCOPE_URL);
    expect(seeded).toBeGreaterThan(5);

    const quota = getTrialQuota(key.id, "qwen3.8-max");
    expect(quota).not.toBeNull();
    expect(quota!.kind).toBe("tokens");
    expect(quota!.limit_amount).toBeGreaterThanOrEqual(1_000_000);
    expect(quota!.remaining).toBe(quota!.limit_amount);
    expect(quota!.exhausted).toBe(false);
  });

  it("does not seed for unknown providers", () => {
    const key = createKey({ alias: "custom", secret: "sk-custom-1", key_type: "standard", region: "ap-southeast-1", base_url: "https://example.com/v1" });
    expect(seedTrialsForKey(key.id, "https://example.com/v1")).toBe(0);
  });

  it("tracks token consumption and exhaustion", () => {
    const key = createKey({ alias: "trial-2", secret: "sk-test-trial-2", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    seedTrialsForKey(key.id, DASHSCOPE_URL);

    consumeTrialTokens(key.id, "qwen3.8-max", 400_000);
    let quota = getTrialQuota(key.id, "qwen3.8-max")!;
    expect(quota.used).toBe(400_000);
    expect(quota.remaining).toBe(quota.limit_amount - 400_000);
    expect(trialExhausted(key.id, "qwen3.8-max")).toBe(false);

    consumeTrialTokens(key.id, "qwen3.8-max", 700_000);
    quota = getTrialQuota(key.id, "qwen3.8-max")!;
    expect(quota.exhausted).toBe(true);
    expect(trialExhausted(key.id, "qwen3.8-max")).toBe(true);
  });

  it("burnTrial marks a row fully spent without touching other models", () => {
    const key = createKey({ alias: "trial-3", secret: "sk-test-trial-3", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    seedTrialsForKey(key.id, DASHSCOPE_URL);

    burnTrial(key.id, "qwen3.7-plus");
    expect(trialExhausted(key.id, "qwen3.7-plus")).toBe(true);
    expect(trialExhausted(key.id, "qwen3.8-plus")).toBe(false);
    // Untracked models are never "exhausted"
    expect(trialExhausted(key.id, "something-else")).toBe(false);
  });

  it("tracks call-based quotas for image/video models", () => {
    const key = createKey({ alias: "trial-4", secret: "sk-test-trial-4", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    seedTrialsForKey(key.id, DASHSCOPE_URL);

    const quota = getTrialQuota(key.id, "wanx2.1-t2i-turbo");
    expect(quota!.kind).toBe("calls");

    consumeTrialCall(key.id, "wanx2.1-t2i-turbo");
    expect(getTrialQuota(key.id, "wanx2.1-t2i-turbo")!.used).toBe(1);
  });

  it("manual quota overrides presets", () => {
    const key = createKey({ alias: "trial-5", secret: "sk-test-trial-5", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    seedTrialsForKey(key.id, DASHSCOPE_URL);

    const updated = setTrialQuota(key.id, "qwen3.8-max", "tokens", 5000, null);
    expect(updated.limit_amount).toBe(5000);
    expect(updated.source).toBe("manual");

    consumeTrialTokens(key.id, "qwen3.8-max", 5000);
    expect(trialExhausted(key.id, "qwen3.8-max")).toBe(true);
  });

  it("builds a radar report with per-model aggregates", () => {
    const k1 = createKey({ alias: "radar-a", secret: "sk-test-radar-a", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    const k2 = createKey({ alias: "radar-b", secret: "sk-test-radar-b", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    seedTrialsForKey(k1.id, DASHSCOPE_URL);
    seedTrialsForKey(k2.id, DASHSCOPE_URL);
    createGroup({ id: "g1", display_name: "G1", candidates: [{ upstream_model_id: "qwen3.8-max", priority: 1, capabilities: ["chat"] }] });

    consumeTrialTokens(k1.id, "qwen3.8-max", 100);

    const radar = getTrialRadar();
    expect(radar.totals.models_tracked).toBeGreaterThan(3);
    expect(radar.totals.keys_tracked).toBe(2);

    const maxRow = radar.models.find((m) => m.model === "qwen3.8-max")!;
    expect(maxRow.keys).toHaveLength(2);
    expect(maxRow.total_limit).toBe(2_000_000);
    expect(maxRow.total_remaining).toBe(2_000_000 - 100);
    expect(maxRow.live_keys).toBe(2);
  });

  it("lists trials expiring soon with quota remaining", () => {
    const key = createKey({ alias: "expiry", secret: "sk-test-expiry", key_type: "standard", region: "ap-southeast-1", base_url: DASHSCOPE_URL });
    setTrialQuota(key.id, "expiring-model", "tokens", 1000, new Date(Date.now() + 2 * 86400_000).toISOString());
    setTrialQuota(key.id, "far-model", "tokens", 1000, new Date(Date.now() + 200 * 86400_000).toISOString());
    setTrialQuota(key.id, "spent-model", "tokens", 1000, new Date(Date.now() + 2 * 86400_000).toISOString());
    consumeTrialTokens(key.id, "spent-model", 1000);

    const expiring = getExpiringTrials(7);
    const models = expiring.map((e) => e.model);
    expect(models).toContain("expiring-model");
    expect(models).not.toContain("far-model");
    expect(models).not.toContain("spent-model");
  });
});
