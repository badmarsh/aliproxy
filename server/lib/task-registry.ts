/**
 * Async task registry — maps upstream task ids (video/image generation)
 * back to the key that submitted them, so polls hit the right account.
 *
 * Process-local: entries are lost on restart. Acceptable for the Trial Farm
 * use case (tasks complete within minutes); a persistent table can replace
 * this Map later without changing call sites.
 */

const tasks = new Map<string, { keyId: string; model: string; createdAt: number }>();

const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ENTRIES = 1000;

export function rememberTask(taskId: string, keyId: string, model: string): void {
  // Prune old entries so the registry cannot grow unbounded
  if (tasks.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [id, entry] of Array.from(tasks.entries())) {
      if (now - entry.createdAt > MAX_AGE_MS) tasks.delete(id);
    }
    if (tasks.size >= MAX_ENTRIES) tasks.clear();
  }
  tasks.set(taskId, { keyId, model, createdAt: Date.now() });
}

export function recallTask(taskId: string): { keyId: string; model: string } | null {
  const entry = tasks.get(taskId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > MAX_AGE_MS) {
    tasks.delete(taskId);
    return null;
  }
  return { keyId: entry.keyId, model: entry.model };
}
