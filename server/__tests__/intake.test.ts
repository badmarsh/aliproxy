import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb } from "../lib/database.js";
import { listKeys } from "../lib/secret-store.js";
import { parseKeyFile, scanIntakeDir } from "../lib/intake-watcher.js";
import { getTrialRadar } from "../lib/trial-store.js";

describe("intake watcher", () => {
  let dir: string;

  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM trial_quotas").run();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
    dir = mkdtempSync(join(tmpdir(), "aliproxy-intake-"));
  });

  it("parses raw sk- lines", () => {
    const raws = parseKeyFile("keys.txt", "sk-aaa111\nsk-bbb222\n\n# comment\nsk-ccc333\n");
    expect(raws).toHaveLength(3);
    expect(raws[0].secret).toBe("sk-aaa111");
  });

  it("parses the DashScope console CSV export", () => {
    const csv = [
      "id,42",
      "apiKey,sk-console-export",
      "apiHost,dashscope-intl.aliyuncs.com",
      "openAiCompatible,https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      "workspaceName,MyTrial",
    ].join("\n");
    const raws = parseKeyFile("export.csv", csv);
    expect(raws).toHaveLength(1);
    expect(raws[0].apiKey).toBe("sk-console-export");
    expect(raws[0].openAiCompatible).toContain("compatible-mode/v1");
  });

  it("parses JSON {keys:[…]}", () => {
    const raws = parseKeyFile(
      "batch.json",
      JSON.stringify({ keys: [{ secret: "sk-json-1", base_url: "https://api.deepseek.com/v1" }] }),
    );
    expect(raws).toHaveLength(1);
    expect(raws[0].base_url).toContain("deepseek");
  });

  it("imports dropped files, seeds trials, and moves them to processed/", async () => {
    writeFileSync(join(dir, "fresh-keys.txt"), "sk-intake-001\nsk-intake-002\n", "utf-8");

    const report = await scanIntakeDir(dir);

    expect(report.files_handled).toBe(1);
    expect(report.keys_imported).toBe(2);
    expect(report.processed_files).toContain("fresh-keys.txt");

    const keys = listKeys();
    expect(keys).toHaveLength(2);
    expect(keys.some((k) => k.alias === "Intake-e-001" || k.alias.includes("Intake-"))).toBe(true);
    expect(keys.every((k) => k.base_url.includes("dashscope"))).toBe(true);

    // trial quotas seeded for both keys
    const radar = getTrialRadar();
    expect(radar.totals.keys_tracked).toBe(2);
    expect(radar.totals.models_tracked).toBeGreaterThan(5);

    // file moved out of the intake root
    expect(existsSync(join(dir, "fresh-keys.txt"))).toBe(false);
    const processed = readdirSync(join(dir, "processed"));
    expect(processed).toHaveLength(1);
    expect(processed[0].endsWith("fresh-keys.txt")).toBe(true);
  });

  it("re-scans without duplicating imports", async () => {
    writeFileSync(join(dir, "good.txt"), "sk-intake-good-1\nsk-intake-good-2\n", "utf-8");

    const first = await scanIntakeDir(dir);
    expect(first.keys_imported).toBe(2);

    const second = await scanIntakeDir(dir);
    expect(second.files_handled).toBe(0); // root is empty now
    expect(listKeys()).toHaveLength(2);
  });

  it("moves files with no parseable keys to failed/", async () => {
    writeFileSync(join(dir, "empty.txt"), "# only comments\n\n", "utf-8");
    const report = await scanIntakeDir(dir);
    expect(report.keys_imported).toBe(0);
    expect(existsSync(join(dir, "failed"))).toBe(true);
    const failed = readdirSync(join(dir, "failed"));
    expect(failed).toHaveLength(1);
  });
});
