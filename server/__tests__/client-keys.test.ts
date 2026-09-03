import { describe, it, expect, beforeEach } from "vitest";
import app from "../index.js";
import { getDb } from "../lib/database.js";
import { createKey } from "../lib/secret-store.js";
import { createGroup } from "../lib/group-store.js";
import { config } from "../lib/config.js";
import {
  createClientKey,
  authenticateClientKey,
  rotateClientKey,
  listClientKeys,
} from "../lib/client-key-store.js";
import { resetRateLimiter } from "../lib/rate-limiter.js";

const ECHO_URL = "echo://local";

function setupEchoGroup(groupId = "echo-group-test") {
  const key = createKey({ alias: `Echo Test ${groupId}`, secret: `echo-${groupId}`, key_type: "standard", region: "local", base_url: ECHO_URL, groups: [groupId] });
  createGroup({
    id: groupId,
    display_name: "Echo Test Group",
    candidates: [{ upstream_model_id: "echo-chat", priority: 1, capabilities: ["chat", "streaming"] }],
  });
  return key;
}

describe("client keys (virtual sk-aliproxy-* keys)", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM trial_quotas").run();
    db.prepare("DELETE FROM usage_daily").run();
    db.prepare("DELETE FROM client_keys").run();
    db.prepare("DELETE FROM request_logs").run();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
    resetRateLimiter();
  });

  it("creates, authenticates, and rotates keys", () => {
    const { record, plaintext } = createClientKey({ name: "test-key" });
    expect(plaintext.startsWith("sk-aliproxy-")).toBe(true);

    const authed = authenticateClientKey(plaintext);
    expect(authed?.id).toBe(record.id);

    const rotated = rotateClientKey(record.id)!;
    expect(authenticateClientKey(rotated.plaintext)?.id).toBe(record.id);
    expect(authenticateClientKey(plaintext)).toBeNull(); // old token dead
  });

  it("authenticates /v1 chat with a client key and records usage", async () => {
    setupEchoGroup();
    const { plaintext } = createClientKey({ name: "http-key" });

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "echo-group-test", messages: [{ role: "user", content: "hello farm" }] }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.choices[0].message.content).toContain("Echo");

    const keys = listClientKeys();
    expect(keys[0].total_requests).toBe(1);
    expect(keys[0].total_tokens).toBeGreaterThan(0);
  });

  it("rejects unknown or disabled client keys", async () => {
    setupEchoGroup();

    const bogus = await app.request("/v1/models", {
      headers: { Authorization: "Bearer sk-aliproxy-deadbcefdeadbcefdeadbcef" },
    });
    expect(bogus.status).toBe(401);

    const { record, plaintext } = createClientKey({ name: "disabled-key" });
    const { updateClientKey } = await import("../lib/client-key-store.js");
    updateClientKey(record.id, { enabled: false });

    const disabled = await app.request("/v1/models", {
      headers: { Authorization: `Bearer ${plaintext}` },
    });
    expect(disabled.status).toBe(401);
  });

  it("enforces rpm limits with 429 + Retry-After", async () => {
    setupEchoGroup("echo-rpm");
    const { plaintext } = createClientKey({ name: "rpm-key", rpm_limit: 1 });

    const first = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "echo-rpm", messages: [{ role: "user", content: "one" }] }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "echo-rpm", messages: [{ role: "user", content: "two" }] }),
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
    const err: any = await second.json();
    expect(err.error.code).toBe("client_key_rate_limited");
  });

  it("enforces daily request budgets", async () => {
    setupEchoGroup("echo-budget");
    const { plaintext } = createClientKey({ name: "budget-key", daily_request_limit: 1 });

    const first = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "echo-budget", messages: [{ role: "user", content: "one" }] }),
    });
    expect(first.status).toBe(200);

    resetRateLimiter(); // don't let RPM interfere
    const second = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "echo-budget", messages: [{ role: "user", content: "two" }] }),
    });
    expect(second.status).toBe(429);
    const err: any = await second.json();
    expect(err.error.code).toBe("client_key_daily_requests_exceeded");
  });

  it("restricts client keys to allowed groups", async () => {
    setupEchoGroup("allowed-group");
    setupEchoGroup("secret-group");
    const { plaintext } = createClientKey({ name: "scoped-key", allowed_group_ids: ["allowed-group"] });

    const ok = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "allowed-group", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(ok.status).toBe(200);

    resetRateLimiter();
    const forbidden = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${plaintext}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "secret-group", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(forbidden.status).toBe(403);
    const err: any = await forbidden.json();
    expect(err.error.code).toBe("group_not_allowed");
  });

  it("master key still works and records usage under __master__", async () => {
    setupEchoGroup();
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.proxy.apiKeyRaw}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "echo-group-test", messages: [{ role: "user", content: "master" }] }),
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) as c FROM usage_daily WHERE client_key_id = ?")
      .get("__master__") as any;
    expect(row.c).toBeGreaterThan(0);
  });
});
