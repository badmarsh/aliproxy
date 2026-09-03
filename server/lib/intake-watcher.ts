/**
 * Intake watcher — the "drop folder" for new trial keys.
 *
 * Alibaba has no OAuth/API for minting DashScope keys (the console is the
 * only documented path), so the last manual step is: copy the sk-… out of
 * the Model Studio console. Everything after that is automated here:
 *
 *   - watches a local folder (default ./incoming, INTAKE_DIR to override)
 *   - accepts raw sk-… lines, the DashScope console CSV export format,
 *     or JSON ({keys:[…]} / arrays)
 *   - imports + encrypts keys, seeds trial quotas, optionally auto-attaches
 *     them to groups (INTAKE_AUTO_GROUPS=g1,g2)
 *   - moves the file to processed/ (or failed/) so nothing is imported twice
 *
 * Triggered automatically by fs.watch and manually via POST /api/keys/intake/scan.
 */

import { watch, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, WatchOptions } from "node:fs";
import { join, resolve, basename } from "node:path";
import { createLogger } from "./logger.js";
import { config } from "./config.js";
import { importKeysBatch } from "./secret-store.js";
import { detectKeyType, detectRegion } from "./csv-parser.js";
import { seedAllMissingTrials } from "./trial-store.js";

const log = createLogger("intake");

const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export interface IntakeReport {
  scanned_at: string;
  dir: string;
  files_handled: number;
  keys_imported: number;
  keys_skipped: number;
  errors: string[];
  processed_files: string[];
}

interface RawKeyInput {
  alias?: string;
  secret?: string;
  apiKey?: string;
  key_type?: string;
  region?: string;
  base_url?: string;
  openAiCompatible?: string;
  apiHost?: string;
  groups?: string[];
}

/** Parse one file's content into importable key inputs. */
export function parseKeyFile(name: string, content: string): RawKeyInput[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // JSON: array, {keys:[…]}, or a single object
  if (name.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const list: RawKeyInput[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.keys)
          ? parsed.keys
          : [parsed];
      return list.filter((k) => k && (k.secret || k.apiKey));
    } catch {
      // fall through to text/CSV parsing
    }
  }

  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);

  // DashScope console CSV export: comma-separated key,value lines
  const looksLikeKv = lines.some((l) => l.toLowerCase().startsWith("apikey,"));
  if (name.endsWith(".csv") || looksLikeKv) {
    const record: Record<string, string> = {};
    for (const line of lines) {
      const idx = line.indexOf(",");
      if (idx === -1) continue;
      record[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    if (record.apiKey) {
      return [
        {
          alias: record.workspaceName ? `${record.workspaceName}-${record.id || "key"}` : undefined,
          apiKey: record.apiKey,
          openAiCompatible: record.openAiCompatible,
          apiHost: record.apiHost,
        },
      ];
    }
  }

  // Plain text: one secret per line
  return lines.filter((l) => !l.startsWith("#")).map((secret) => ({ secret }));
}

function toImportInput(raw: RawKeyInput) {
  const secret = raw.secret || raw.apiKey || "";
  const baseUrl = raw.base_url || raw.openAiCompatible || DEFAULT_BASE_URL;
  return {
    alias: raw.alias || `Intake-${secret.slice(-6)}`,
    secret,
    key_type: (raw.key_type || detectKeyType(secret)) as ReturnType<typeof detectKeyType>,
    region: raw.region || (raw.apiHost ? detectRegion(raw.apiHost) : detectRegion(baseUrl)),
    workspace_id: null,
    base_url: baseUrl,
    groups: raw.groups && raw.groups.length > 0 ? raw.groups : config.intake.autoGroups,
  };
}

const STABLE_MS = 400;

async function waitForStableFile(path: string): Promise<boolean> {
  try {
    const s1 = readFileSync(path).length;
    await new Promise((r) => setTimeout(r, STABLE_MS));
    const s2 = readFileSync(path).length;
    return s1 === s2;
  } catch {
    return false;
  }
}

/** Scan the intake dir once: import every stable, unhandled file. */
export async function scanIntakeDir(dirOverride?: string): Promise<IntakeReport> {
  const dir = resolve(dirOverride || config.intake.dir);
  const report: IntakeReport = {
    scanned_at: new Date().toISOString(),
    dir,
    files_handled: 0,
    keys_imported: 0,
    keys_skipped: 0,
    errors: [],
    processed_files: [],
  };

  if (!existsSync(dir)) return report;

  const entries = readdirSync(dir).filter((f) => !f.startsWith("."));
  for (const entry of entries) {
    const path = join(dir, entry);
    let stat;
    try {
      stat = await (await import("node:fs")).promises.stat(path);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    if (!(await waitForStableFile(path))) {
      report.errors.push(`${entry}: file still being written, will retry`);
      continue;
    }

    report.files_handled++;
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch (err: any) {
      report.errors.push(`${entry}: unreadable (${err.message})`);
      continue;
    }

    try {
      const raws = parseKeyFile(entry, content);
      if (raws.length === 0) {
        report.errors.push(`${entry}: no keys found`);
        moveTo(dir, path, "failed");
        continue;
      }
      const result = importKeysBatch(raws.map(toImportInput));
      report.keys_imported += result.imported;
      report.keys_skipped += result.skipped;
      report.errors.push(...result.errors.map((e) => `${entry}: ${e}`));
      // Seed trial quotas for anything new
      if (result.imported > 0) seedAllMissingTrials();
      moveTo(dir, path, result.imported > 0 ? "processed" : "failed");
      report.processed_files.push(entry);
      log.info("Intake file processed", { file: entry, imported: result.imported, skipped: result.skipped });
    } catch (err: any) {
      report.errors.push(`${entry}: ${err.message}`);
      moveTo(dir, path, "failed");
    }
  }

  return report;
}

function moveTo(dir: string, path: string, subfolder: "processed" | "failed"): void {
  try {
    const target = join(dir, subfolder);
    mkdirSync(target, { recursive: true });
    const base = basename(path);
    const stamped = `${Date.now()}-${base}`;
    renameSync(path, join(target, stamped));
  } catch (err: any) {
    log.warn("Could not move intake file", { path, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Watcher
// ---------------------------------------------------------------------------

let watcher: ReturnType<typeof watch> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastReport: IntakeReport | null = null;
let scanning = false;

export function startIntakeWatcher(): void {
  if (!config.intake.watch) return;

  const dir = resolve(config.intake.dir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log.info("Intake folder created — drop key files here to import", { dir });
  }

  log.info("Watching intake folder", { dir, autoGroups: config.intake.autoGroups });
  void scanIntakeDir().then((r) => (lastReport = r));

  const opts: WatchOptions = { persistent: false };
  watcher = watch(dir, opts, () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runScan(), 1000);
  });
}

async function runScan(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    lastReport = await scanIntakeDir();
  } finally {
    scanning = false;
  }
}

export function stopIntakeWatcher(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  watcher?.close();
  watcher = null;
}

export function getIntakeStatus(): { dir: string; watching: boolean; auto_groups: string[]; last_report: IntakeReport | null } {
  return {
    dir: resolve(config.intake.dir),
    watching: watcher !== null,
    auto_groups: config.intake.autoGroups,
    last_report: lastReport,
  };
}
