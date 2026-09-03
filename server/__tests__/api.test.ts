import { describe, it, expect, beforeEach } from "vitest";
import app from "../index.js";
import { getDb } from "../lib/database.js";
import { createKey } from "../lib/secret-store.js";
import { createGroup } from "../lib/group-store.js";
import { config } from "../lib/config.js";

describe("HTTP API Endpoints", () => {
  const validAuth = `Bearer ${config.proxy.apiKeyRaw}`;

  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
    db.prepare("DELETE FROM request_logs").run();
  });

  it("GET /health should return 200 without authentication", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.proxy_version).toBeDefined();
  });

  it("GET /ready should return 503 when no groups are configured", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.status).toBe("not_ready");
  });

  it("GET /ready should return 503 when group has no eligible keys", async () => {
    createGroup({
      id: "test-ready-group",
      display_name: "Ready Group",
      candidates: [{ upstream_model_id: "m", priority: 1, capabilities: ["chat"] }],
    });

    const res = await app.request("/ready");
    expect(res.status).toBe(503);
  });

  it("GET /ready should return 200 when group has active key", async () => {
    const key = createKey({
      alias: "Ready Key",
      secret: "sk-ready",
      key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://example.com",
      groups: ["test-ready-group"],
    });

    createGroup({
      id: "test-ready-group",
      display_name: "Ready Group",
      key_ids: [key.id],
      candidates: [{ upstream_model_id: "m", priority: 1, capabilities: ["chat"] }],
    });

    const res = await app.request("/ready");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.eligible_keys).toBe(1);
  });

  it("GET /v1/models requires valid proxy API key", async () => {
    // Missing auth
    const resNoAuth = await app.request("/v1/models");
    expect(resNoAuth.status).toBe(401);

    // Invalid auth
    const resBadAuth = await app.request("/v1/models", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(resBadAuth.status).toBe(401);

    // Valid auth
    createGroup({
      id: "qwen3.7-plus",
      display_name: "Qwen 3.7 Plus",
      aliases: ["gpt-4o-mini"],
      candidates: [],
    });

    const res = await app.request("/v1/models", {
      headers: { Authorization: validAuth },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe("list");
    const modelIds = body.data.map((m: any) => m.id);
    expect(modelIds).toContain("qwen3.7-plus");
    expect(modelIds).toContain("gpt-4o-mini");
  });

  it("Admin endpoints require valid proxy API key", async () => {
    // Missing auth on /api/keys
    const resNoAuth = await app.request("/api/keys");
    expect(resNoAuth.status).toBe(401);

    // Wrong auth
    const resBadAuth = await app.request("/api/keys", {
      headers: { Authorization: "Bearer wrong-admin-key" },
    });
    expect(resBadAuth.status).toBe(401);

    // Valid auth
    const res = await app.request("/api/keys", {
      headers: { Authorization: validAuth },
    });
    expect(res.status).toBe(200);
  });

  it("GET /api/config returns configuration", async () => {
    const res = await app.request("/api/config", {
      headers: { Authorization: validAuth },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.proxy.port).toBeDefined();
    expect(body.data.routing.defaultRegion).toBeDefined();
  });
});
