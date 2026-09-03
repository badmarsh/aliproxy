import { describe, it, expect, beforeEach } from "vitest";
import {
  createKey,
  getKey,
  listKeys,
  updateKey,
  deleteKey,
  computeFingerprint,
  getKeyWithSecret,
  importKeysBatch,
} from "../lib/secret-store.js";
import { getDb } from "../lib/database.js";

describe("Secret Store & Crypto", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
  });

  it("should create and retrieve a key with encrypted secret", () => {
    const testSecret = "sk-ws-test-secret-1234567890";
    const key = createKey({
      alias: "Test Key",
      secret: testSecret,
      key_type: "workspace_scoped",
      region: "ap-southeast-1",
      base_url: "https://example.com/v1",
      groups: ["qwen3.7-plus"],
    });

    expect(key.id).toBeDefined();
    expect(key.alias).toBe("Test Key");
    expect(key.key_type).toBe("workspace_scoped");
    expect(key.fingerprint).toBe(computeFingerprint(testSecret));
    expect(key.groups).toContain("qwen3.7-plus");

    // Standard getKey should not have plaintext secret
    const retrieved = getKey(key.id);
    expect(retrieved).not.toBeNull();
    expect((retrieved as any).secret).toBeUndefined();

    // getKeyWithSecret should decrypt correctly
    const withSecret = getKeyWithSecret(key.id);
    expect(withSecret).not.toBeNull();
    expect(withSecret!.secret).toBe(testSecret);
  });

  it("should prevent duplicate key insertion with same fingerprint", () => {
    const testSecret = "sk-ws-duplicate-check";
    createKey({
      alias: "Key 1",
      secret: testSecret,
      key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://example.com/v1",
    });

    expect(() => {
      createKey({
        alias: "Key 2",
        secret: testSecret,
        key_type: "standard",
        region: "ap-southeast-1",
        base_url: "https://example.com/v1",
      });
    }).toThrow(/already exists/);
  });

  it("should perform batch import with deduplication in single transaction", () => {
    const inputs = [
      {
        alias: "Batch 1",
        secret: "sk-batch-1",
        key_type: "standard" as const,
        region: "ap-southeast-1",
        base_url: "https://example.com/v1",
      },
      {
        alias: "Batch 2",
        secret: "sk-batch-2",
        key_type: "standard" as const,
        region: "ap-southeast-1",
        base_url: "https://example.com/v1",
      },
      {
        alias: "Batch 1 Duplicate",
        secret: "sk-batch-1",
        key_type: "standard" as const,
        region: "ap-southeast-1",
        base_url: "https://example.com/v1",
      },
    ];

    const result = importKeysBatch(inputs);
    expect(result.total).toBe(3);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors.length).toBe(0);

    const all = listKeys();
    expect(all.length).toBe(2);
  });

  it("should update key status and cooldown", () => {
    const key = createKey({
      alias: "Status Key",
      secret: "sk-status-test",
      key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://example.com/v1",
    });

    const cooldownTime = new Date(Date.now() + 60000).toISOString();
    const updated = updateKey(key.id, {
      status: "rate_limited",
      cooldown_until: cooldownTime,
      last_error_code: "429",
      last_error_message: "Rate limit reached",
    });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("rate_limited");
    expect(updated!.cooldown_until).toBe(cooldownTime);
    expect(updated!.last_error_code).toBe("429");
  });

  it("should delete a key and clean up its groups", () => {
    const key = createKey({
      alias: "Delete Key",
      secret: "sk-delete-test",
      key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://example.com/v1",
      groups: ["group-a"],
    });

    const deleted = deleteKey(key.id);
    expect(deleted).toBe(true);
    expect(getKey(key.id)).toBeNull();

    const db = getDb();
    const links = db.prepare("SELECT * FROM key_groups WHERE key_id = ?").all(key.id);
    expect(links.length).toBe(0);
  });
});
