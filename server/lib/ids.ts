import { randomUUID } from "node:crypto";

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}
