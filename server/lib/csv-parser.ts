import { readFileSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { createLogger } from "./logger.js";
import type { CsvKeyRecord } from "./types.js";

const log = createLogger("csv-parser");

export function parseCsvKey(filePath: string): CsvKeyRecord {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const record: Record<string, string> = {};
  for (const line of lines) {
    const commaIdx = line.indexOf(",");
    if (commaIdx === -1) continue;
    const key = line.slice(0, commaIdx).trim();
    const value = line.slice(commaIdx + 1).trim();
    record[key] = value;
  }

  const required = ["id", "apiKey", "apiHost", "openAiCompatible", "workspaceId"];
  for (const field of required) {
    if (!record[field]) {
      throw new Error(`Missing required field '${field}' in ${basename(filePath)}`);
    }
  }

  return {
    id: record.id,
    apiKey: record.apiKey,
    apiHost: record.apiHost,
    openAiCompatible: record.openAiCompatible,
    dashScope: record.dashScope || "",
    description: record.description || "",
    workspaceName: record.workspaceName || "",
    workspaceId: record.workspaceId,
  };
}

export function parseAllCsvKeys(directory: string): CsvKeyRecord[] {
  const files = readdirSync(directory) as string[];
  const csvFiles = files.filter((f: string) => f.endsWith(".csv"));

  const records: CsvKeyRecord[] = [];
  for (const file of csvFiles) {
    try {
      const record = parseCsvKey(`${directory}/${file}`);
      records.push(record);
    } catch (err) {
      log.warn("Failed to parse CSV", { file, error: (err as Error).message });
    }
  }

  log.info("Parsed CSV keys", { total: records.length, files: csvFiles.length });
  return records;
}

export function detectRegion(apiHost: string): string {
  if (apiHost.includes("ap-southeast-1")) return "ap-southeast-1";
  if (apiHost.includes("cn-beijing")) return "cn-beijing";
  if (apiHost.includes("us-east-1")) return "us-east-1";
  return "ap-southeast-1";
}

export function detectKeyType(apiKey: string): "standard" | "coding_plan" | "workspace_scoped" {
  if (apiKey.startsWith("sk-sp-")) return "coding_plan";
  if (apiKey.startsWith("sk-ws-")) return "workspace_scoped";
  return "standard";
}
