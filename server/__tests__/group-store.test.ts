import { describe, it, expect, beforeEach } from "vitest";
import {
  createGroup,
  getGroup,
  listGroups,
  updateGroup,
  deleteGroup,
  resolveAliasOrGroup,
} from "../lib/group-store.js";
import { getDb } from "../lib/database.js";

describe("Group Store & Alias Resolution", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM model_groups").run();
  });

  it("should create and retrieve a model group with candidates and aliases", () => {
    const group = createGroup({
      id: "qwen3.7-plus",
      display_name: "Qwen 3.7 Plus",
      aliases: ["gpt-4o-mini"],
      candidates: [
        {
          upstream_model_id: "qwen3.7-plus-2026-05-26",
          priority: 1,
          capabilities: ["chat", "streaming", "tools"],
        },
        {
          upstream_model_id: "qwen3.7-plus",
          priority: 2,
          capabilities: ["chat", "streaming", "tools"],
        },
      ],
      strategy: "first_available",
    });

    expect(group.id).toBe("qwen3.7-plus");
    expect(group.aliases).toContain("gpt-4o-mini");
    expect(group.candidates.length).toBe(2);
    expect(group.candidates[0].upstream_model_id).toBe("qwen3.7-plus-2026-05-26");

    const retrieved = getGroup("qwen3.7-plus");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.display_name).toBe("Qwen 3.7 Plus");
  });

  it("should resolve by group id directly", () => {
    createGroup({
      id: "qwen3.8-max",
      display_name: "Qwen 3.8 Max",
      aliases: ["gpt-4o"],
      candidates: [
        { upstream_model_id: "qwen3.8-max-0902", priority: 1, capabilities: ["chat"] },
      ],
    });

    const resolved = resolveAliasOrGroup("qwen3.8-max");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe("qwen3.8-max");
  });

  it("should resolve by alias to the target group", () => {
    createGroup({
      id: "qwen3.8-max",
      display_name: "Qwen 3.8 Max",
      aliases: ["gpt-4o", "claude-opus-4"],
      candidates: [
        { upstream_model_id: "qwen3.8-max-0902", priority: 1, capabilities: ["chat"] },
      ],
    });

    const resolved = resolveAliasOrGroup("gpt-4o");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe("qwen3.8-max");

    const resolved2 = resolveAliasOrGroup("claude-opus-4");
    expect(resolved2).not.toBeNull();
    expect(resolved2!.id).toBe("qwen3.8-max");
  });

  it("should return null for non-existent model or alias", () => {
    const resolved = resolveAliasOrGroup("non-existent-model");
    expect(resolved).toBeNull();
  });

  it("should not resolve disabled groups", () => {
    createGroup({
      id: "disabled-group",
      display_name: "Disabled",
      aliases: ["test-alias"],
      candidates: [],
      enabled: false,
    });

    expect(resolveAliasOrGroup("disabled-group")).toBeNull();
    expect(resolveAliasOrGroup("test-alias")).toBeNull();
  });
});
