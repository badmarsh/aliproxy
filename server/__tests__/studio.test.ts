import { describe, it, expect, beforeEach } from "vitest";
import app from "../index.js";
import { getDb } from "../lib/database.js";
import { createKey } from "../lib/secret-store.js";
import { createGroup } from "../lib/group-store.js";
import { config } from "../lib/config.js";

const ECHO_URL = "echo://local";
const auth = { Authorization: `Bearer ${config.proxy.apiKeyRaw}`, "Content-Type": "application/json" };

function setup() {
  createKey({
    alias: "Echo Studio",
    secret: "echo-studio",
    key_type: "standard",
    region: "local",
    base_url: ECHO_URL,
    groups: ["studio-image", "studio-video"],
  });
  createGroup({
    id: "studio-image",
    display_name: "Studio Image",
    candidates: [{ upstream_model_id: "echo-image", priority: 1, capabilities: ["images"] }],
  });
  createGroup({
    id: "studio-video",
    display_name: "Studio Video",
    candidates: [{ upstream_model_id: "echo-video", priority: 1, capabilities: ["video"] }],
  });
}

describe("Studio passthrough endpoints", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM trial_quotas").run();
    db.prepare("DELETE FROM usage_daily").run();
    db.prepare("DELETE FROM request_logs").run();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
    setup();
  });

  it("generates images via POST /api/proxy/images/generations (admin auth)", async () => {
    const res = await app.request("/api/proxy/images/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "studio-image",
        prompt: "a hoarder dragon on a pile of API keys",
        negative_prompt: "blurry",
        n: 2,
        size: "1024x1024",
      }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].b64_json).toBeTruthy();
    expect(res.headers.get("X-Aliproxy-Upstream-Model")).toBe("echo-image");

    // metered: request log with studio client ip + usage row + trial call
    const db = getDb();
    const log = db
      .prepare("SELECT COUNT(*) c FROM request_logs WHERE client_ip = 'studio' AND requested_model = ?")
      .get("studio-image") as any;
    expect(log.c).toBe(1);
    const usage = db.prepare("SELECT SUM(requests) c FROM usage_daily WHERE model = ?").get("echo-image") as any;
    expect(usage.c).toBe(1);
  });

  it("submits and polls video tasks via the admin passthrough", async () => {
    const submit = await app.request("/api/proxy/videos/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        model: "studio-video",
        input: { prompt: "the dragon takes flight", negative_prompt: "shaky cam" },
        parameters: { size: "1280*720" },
      }),
    });
    expect(submit.status).toBe(200);
    const body: any = await submit.json();
    expect(body.output.task_id).toBeTruthy();

    const poll = await app.request(`/api/proxy/videos/generations/${body.output.task_id}`, {
      headers: { Authorization: auth.Authorization },
    });
    expect(poll.status).toBe(200);
    const pollBody: any = await poll.json();
    expect(["PENDING", "RUNNING", "SUCCEEDED"]).toContain(pollBody.output.task_status);
  });

  it("rejects unauthenticated studio calls", async () => {
    const res = await app.request("/api/proxy/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "studio-image", prompt: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("validates required fields", async () => {
    const res = await app.request("/api/proxy/images/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "studio-image" }),
    });
    expect(res.status).toBe(400);
  });
});
