import { describe, it, expect, beforeEach } from "vitest";
import {
  dispatchKey,
  markKeyCooldown,
  markKeyStatus,
  incrementKeyFailure,
} from "../lib/dispatcher.js";
import { createKey, updateKey } from "../lib/secret-store.js";
import { createGroup } from "../lib/group-store.js";
import { getDb } from "../lib/database.js";

describe("Dispatcher & Selection Strategies", () => {
  let key1Id: string;
  let key2Id: string;
  let key3Id: string;
  const groupId = "test-dispatch-group";

  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();

    const k1 = createKey({
      alias: "Key 1",
      secret: "sk-dispatch-1",
      key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://example.com/v1",
      groups: [groupId],
    });
    key1Id = k1.id;

    const k2 = createKey({
      alias: "Key 2",
      secret: "sk-dispatch-2",
      key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://example.com/v1",
      groups: [groupId],
    });
    key2Id = k2.id;

    const k3 = createKey({
      alias: "Key 3",
      secret: "sk-dispatch-3",
      key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://example.com/v1",
      groups: [groupId],
    });
    key3Id = k3.id;

    createGroup({
      id: groupId,
      display_name: "Dispatch Group",
      key_ids: [key1Id, key2Id, key3Id],
      candidates: [{ upstream_model_id: "m1", priority: 1, capabilities: ["chat"] }],
    });
  });

  it("first_available strategy should consistently return the first eligible key", () => {
    const selected1 = dispatchKey(groupId, "first_available");
    const selected2 = dispatchKey(groupId, "first_available");
    expect(selected1).not.toBeNull();
    expect(selected2).not.toBeNull();
    expect(selected1!.id).toBe(selected2!.id);
  });

  it("round_robin strategy should cycle across eligible keys", () => {
    const s1 = dispatchKey(groupId, "round_robin");
    const s2 = dispatchKey(groupId, "round_robin");
    const s3 = dispatchKey(groupId, "round_robin");
    const s4 = dispatchKey(groupId, "round_robin");

    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s3).not.toBeNull();
    expect(s4).not.toBeNull();

    // Cycling through
    expect(s1!.id).toBe(s4!.id);
  });

  it("should never dispatch a key currently in cooldown", () => {
    // Put key1 and key2 in cooldown
    markKeyCooldown(key1Id, 3600, "429", "Rate limit");
    markKeyCooldown(key2Id, 3600, "429", "Rate limit");

    // Only key3 is eligible
    const selected = dispatchKey(groupId, "round_robin");
    expect(selected).not.toBeNull();
    expect(selected!.id).toBe(key3Id);

    const selected2 = dispatchKey(groupId, "first_available");
    expect(selected2!.id).toBe(key3Id);
  });

  it("should never dispatch an invalid or disabled key", () => {
    markKeyStatus(key1Id, "invalid");
    updateKey(key2Id, { enabled: false });

    // Only key3 should be dispatched
    const selected = dispatchKey(groupId, "round_robin");
    expect(selected).not.toBeNull();
    expect(selected!.id).toBe(key3Id);
  });

  it("circuit breaker should place key in cooldown after 5 consecutive failures", () => {
    expect(incrementKeyFailure(key1Id)).toBe(1);
    expect(incrementKeyFailure(key1Id)).toBe(2);
    expect(incrementKeyFailure(key1Id)).toBe(3);
    expect(incrementKeyFailure(key1Id)).toBe(4);
    expect(incrementKeyFailure(key1Id)).toBe(5);

    // After 5 failures, key should be in cooldown (status = rate_limited)
    const db = getDb();
    const row = db.prepare("SELECT status, cooldown_until FROM api_keys WHERE id = ?").get(key1Id) as any;
    expect(row.status).toBe("rate_limited");
    expect(row.cooldown_until).not.toBeNull();
    expect(new Date(row.cooldown_until).getTime()).toBeGreaterThan(Date.now());
  });
});
