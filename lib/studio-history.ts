/**
 * Studio gallery persistence helpers.
 *
 * Real image generation returns `data:image/png;base64,...` strings that easily
 * blow through the browser's ~5MB localStorage quota after a few generations.
 * The studio keeps every prompt/metadata item and strips the heavy pixel
 * payloads oldest-first, marking trimmed items so the user knows to hit
 * "Reuse prompt" to regenerate.
 */

export interface StorageTrimItem {
  kind: "image" | "video";
  images?: string[];
  trimmed?: boolean;
}

export const STUDIO_STORAGE_BUDGET_BYTES = 4_500_000;

function stateSize(gallery: unknown[], baseBytes: number): number {
  return baseBytes + JSON.stringify(gallery).length;
}

/**
 * Return a copy of `gallery` that fits the storage budget. Pixel data is
 * stripped from the oldest image items first; prompts and all generation
 * metadata are always retained.
 */
export function fitGalleryForStorage<T extends StorageTrimItem>(
  gallery: T[],
  options: { budget?: number; baseBytes?: number } = {},
): T[] {
  const budget = options.budget ?? STUDIO_STORAGE_BUDGET_BYTES;
  const baseBytes = options.baseBytes ?? 0;
  const items = gallery.map((item) => ({ ...item }));

  let size = stateSize(items, baseBytes);

  for (let i = items.length - 1; i >= 0 && size > budget; i--) {
    const item = items[i];
    if (item.kind === "image" && item.images && item.images.length > 0) {
      item.images = undefined;
      item.trimmed = true;
      size = stateSize(items, baseBytes);
    }
  }

  return items;
}
