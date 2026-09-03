import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "../lib/database.js";
import { recordUsage } from "../lib/client-key-store.js";
import { getUsageSummary, getUsageDaily, getSavings } from "../lib/usage-analytics.js";
import { estimateCost } from "../lib/pricing.js";

describe("usage analytics & savings meter", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM usage_daily").run();
    db.prepare("DELETE FROM client_keys").run();
  });

  it("estimates cost from the pricing catalog", () => {
    // qwen3.8-max: $1.60 / 1M prompt, $6.40 / 1M completion
    const est = estimateCost("qwen3.8-max", 1_000_000, 500_000);
    expect(est.source).toBe("catalog");
    expect(est.cost_usd).toBeCloseTo(1.6 + 3.2, 4);

    const unknown = estimateCost("totally-unknown-model", 1_000_000, 0);
    expect(unknown.source).toBe("fallback");
  });

  it("rolls usage up by model / group / client", () => {
    recordUsage({ client_key_id: "__master__", group_id: "g1", model: "qwen3.8-max", status_code: 200, prompt_tokens: 1000, completion_tokens: 500 });
    recordUsage({ client_key_id: "__master__", group_id: "g1", model: "qwen3.8-max", status_code: 500, prompt_tokens: 0, completion_tokens: 0 });
    recordUsage({ client_key_id: "__master__", group_id: "g2", model: "qwen3.7-flash", status_code: 200, prompt_tokens: 200, completion_tokens: 100 });

    const summary = getUsageSummary(1);
    expect(summary.totals.requests).toBe(3);
    expect(summary.totals.errors).toBe(1);
    expect(summary.totals.prompt_tokens).toBe(1200);

    const max = summary.by_model.find((m) => m.model === "qwen3.8-max")!;
    expect(max.requests).toBe(2);
    expect(max.cost_usd).toBeGreaterThan(0);

    expect(summary.by_group).toHaveLength(2);
    expect(summary.by_client[0].name).toBe("Master key");
  });

  it("computes all-time savings", () => {
    recordUsage({ client_key_id: "__master__", group_id: null, model: "qwen3.8-max", status_code: 200, prompt_tokens: 2_000_000, completion_tokens: 0 });

    const savings = getSavings();
    expect(savings.free_tokens).toBe(2_000_000);
    expect(savings.estimated_spend_avoided_usd).toBeCloseTo(3.2, 4);
    expect(savings.all_time.requests).toBe(1);
  });

  it("returns a daily series", () => {
    recordUsage({ client_key_id: "__master__", group_id: null, model: "m", status_code: 200, prompt_tokens: 10, completion_tokens: 10 });
    const daily = getUsageDaily(7);
    expect(daily).toHaveLength(1);
    expect(daily[0].requests).toBe(1);
    expect(daily[0].date).toBe(new Date().toISOString().slice(0, 10));
  });
});
