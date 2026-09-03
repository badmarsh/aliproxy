import { describe, it, expect, beforeAll } from "vitest";

describe("API client URL helpers", () => {
  let apiUrl: (path: string) => string;
  let urlFor: (path: string) => URL;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_PROXY_API_URL = "";
    const mod = await import("../api-client");
    apiUrl = mod.apiUrl;
    urlFor = mod.urlFor;
  });

  it("returns same-origin relative paths when no external API origin is configured", () => {
    expect(apiUrl("/api/logs")).toBe("/api/logs");
    expect(apiUrl("/health")).toBe("/health");
    expect(apiUrl("api/logs")).toBe("/api/logs");
  });

  it("builds URL objects with a real base instead of throwing Invalid URL", () => {
    const url = urlFor("/api/logs");
    expect(url.pathname).toBe("/api/logs");
    expect(url.origin).toBe("http://localhost");
  });
});
