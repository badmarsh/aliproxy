import { describe, it, expect, beforeEach } from "vitest";
import app from "../index.js";
import { getDb } from "../lib/database.js";
import { createGroup, getGroup } from "../lib/group-store.js";
import { logRequest, getStats } from "../lib/request-log-store.js";
import { config } from "../lib/config.js";

const auth = { Authorization: `Bearer ${config.proxy.apiKeyRaw}` };

describe("log filters + latency percentiles (P0-2)", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM request_logs").run();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
  });

  function seedLogs() {
    const cases = [
      { model: "alpha", status: 200, latency: 100, streaming: false },
      { model: "alpha", status: 200, latency: 200, streaming: true },
      { model: "alpha", status: 500, latency: 900, streaming: false },
      { model: "beta", status: 200, latency: 300, streaming: true },
      { model: "beta", status: 429, latency: 50, streaming: false },
    ];
    cases.forEach((c, i) =>
      logRequest({
        request_id: `perf-${i}`,
        timestamp: new Date().toISOString(),
        client_ip: "test",
        requested_model: c.model,
        resolved_group_id: "g",
        upstream_model_id: c.model,
        api_key_id: null,
        status_code: c.status,
        error_code: c.status >= 400 ? "err" : null,
        latency_ms: c.latency,
        ttft_ms: null,
        prompt_tokens: 1,
        completion_tokens: 1,
        streaming: c.streaming,
        retry_count: 0,
      }),
    );
  }

  it("filters logs by model, status class, and mode", async () => {
    seedLogs();

    const all = await app.request("/api/logs?limit=50", { headers: auth });
    const allBody: any = await all.json();
    expect(allBody.data).toHaveLength(5);

    const errors = await app.request("/api/logs?status=error", { headers: auth });
    const errorsBody: any = await errors.json();
    expect(errorsBody.data).toHaveLength(2);
    expect(errorsBody.data.every((r: any) => r.status_code >= 400)).toBe(true);

    const okBeta = await app.request("/api/logs?status=ok&model=beta", { headers: auth });
    const okBetaBody: any = await okBeta.json();
    expect(okBetaBody.data).toHaveLength(1);
    expect(okBetaBody.data[0].requested_model).toBe("beta");

    const streams = await app.request("/api/logs?mode=stream", { headers: auth });
    const streamsBody: any = await streams.json();
    expect(streamsBody.data).toHaveLength(2);
    expect(streamsBody.data.every((r: any) => r.streaming)).toBe(true);
  });

  it("reports p50/p95 latency", () => {
    seedLogs();
    const stats = getStats();
    expect(stats.total_requests).toBe(5);
    // sorted latencies: [50, 100, 200, 300, 900]
    expect(stats.p50_latency_ms).toBe(200);
    expect(stats.p95_latency_ms).toBe(900);
    expect(stats.avg_latency_ms).toBe(310);
  });
});

describe("groups export / import (P0-4)", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM request_logs").run();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
  });

  it("round-trips a full group configuration", async () => {
    createGroup({
      id: "backup-group",
      display_name: "Backup Test",
      aliases: ["alias-1"],
      candidates: [{ upstream_model_id: "m1", priority: 1, capabilities: ["chat", "streaming"] }],
    });

    const exportRes = await app.request("/api/groups/export", { headers: auth });
    expect(exportRes.status).toBe(200);
    const exportBody: any = await exportRes.json();
    expect(exportBody.data.count).toBeGreaterThanOrEqual(1);
    const snapshot = exportBody.data.groups;

    // wipe and restore
    const db = getDb();
    db.prepare("DELETE FROM model_groups").run();
    expect(getGroup("backup-group")).toBeNull();

    const importRes = await app.request("/api/groups/import", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ groups: snapshot }),
    });
    expect(importRes.status).toBe(201);
    const importBody: any = await importRes.json();
    expect(importBody.data.created).toBe(snapshot.length);
    expect(importBody.data.errors).toHaveLength(0);

    const restored = getGroup("backup-group")!;
    expect(restored.display_name).toBe("Backup Test");
    expect(restored.aliases).toEqual(["alias-1"]);
    expect(restored.candidates[0].upstream_model_id).toBe("m1");
  });

  it("upserts on import: existing groups update instead of failing", async () => {
    createGroup({ id: "upsert-me", display_name: "Before", candidates: [{ upstream_model_id: "x", priority: 1, capabilities: ["chat"] }] });

    const res = await app.request("/api/groups/import", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify([
        { id: "upsert-me", display_name: "After", candidates: [{ upstream_model_id: "y", priority: 1, capabilities: ["chat"] }] },
      ]),
    });
    const body: any = await res.json();
    expect(body.data.updated).toBe(1);
    expect(body.data.created).toBe(0);
    expect(getGroup("upsert-me")!.display_name).toBe("After");
  });

  it("rejects malformed import payloads", async () => {
    const res = await app.request("/api/groups/import", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});
