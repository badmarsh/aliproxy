import { describe, it, expect } from "vitest";
import { fitGalleryForStorage, STUDIO_STORAGE_BUDGET_BYTES } from "../studio-history";

interface TestImage {
  id: string;
  kind: "image";
  prompt: string;
  images?: string[];
  trimmed?: boolean;
}

describe("studio gallery storage budget", () => {
  it("strips the oldest image payloads first and keeps every prompt", () => {
    const big = "x".repeat(1_000_000);
    const gallery: TestImage[] = [
      { id: "new", kind: "image", prompt: "new prompt", images: [`data:image/png;base64,${big}`] },
      { id: "old", kind: "image", prompt: "old prompt", images: [`data:image/png;base64,${big}`] },
    ];
    const baseBytes = JSON.stringify({ blocks: [], negative: "", mode: "image" }).length;

    // Room for one ~1MB PNG, not two. The oldest item should be stripped.
    const fitted = fitGalleryForStorage(gallery, { budget: baseBytes + 1_050_000, baseBytes });

    expect(fitted[0]).toMatchObject({ id: "new", prompt: "new prompt" });
    expect(fitted[0].images).toBeDefined();

    expect(fitted[1]).toMatchObject({ id: "old", prompt: "old prompt", trimmed: true });
    expect(fitted[1].images).toBeUndefined();

    expect(STUDIO_STORAGE_BUDGET_BYTES).toBeGreaterThan(0);
  });

  it("keeps the gallery untouched when it already fits", () => {
    const gallery: TestImage[] = [{ id: "small", kind: "image", prompt: "nice", images: ["data:image/png;base64,abc"] }];
    const fitted = fitGalleryForStorage(gallery);
    expect(fitted[0].images).toEqual(["data:image/png;base64,abc"]);
    expect(fitted[0].trimmed).toBeUndefined();
  });
});
