import { describe, it, expect, beforeEach } from "vitest";
import app from "../index.js";
import { getDb } from "../lib/database.js";
import { createKey } from "../lib/secret-store.js";
import { createGroup } from "../lib/group-store.js";
import { config } from "../lib/config.js";
import { consumeTrialCall, setTrialQuota } from "../lib/trial-store.js";
import { seedTrialsForKey } from "../lib/trial-store.js";

const ECHO_URL = "echo://local";
const auth = { Authorization: `Bearer ${config.proxy.apiKeyRaw}`, "Content-Type": "application/json" };

function setup() {
  createKey({ alias: "Echo", secret: "echo-mm", key_type: "standard", region: "local", base_url: ECHO_URL, groups: ["mm-image", "mm-video"] });
  createGroup({
    id: "mm-image",
    display_name: "Image",
    candidates: [{ upstream_model_id: "echo-image", priority: 1, capabilities: ["images"] }],
  });
  createGroup({
    id: "mm-video",
    display_name: "Video",
    candidates: [{ upstream_model_id: "echo-video", priority: 1, capabilities: ["video"] }],
  });
}

describe("multimodal endpoints (images & video)", () => {
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

  it("generates images via /v1/images/generations and meters a trial call", async () => {
    const db = getDb();
    const keyRow = db.prepare("SELECT id FROM api_keys LIMIT 1").get() as any;
    setTrialQuota(keyRow.id, "echo-image", "calls", 10, null);

    const res = await app.request("/v1/images/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "mm-image", prompt: "a data cat", n: 2 }),
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].b64_json).toBeTruthy();
    expect(res.headers.get("X-Aliproxy-Upstream-Model")).toBe("echo-image");

    // usage + trial call recorded
    const usage = db.prepare("SELECT SUM(requests) c FROM usage_daily WHERE model = ?").get("echo-image") as any;
    expect(usage.c).toBe(1);
  });

  it("requires a prompt", async () => {
    const res = await app.request("/v1/images/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "mm-image" }),
    });
    expect(res.status).toBe(400);
  });

  it("submits async video tasks and polls them", async () => {
    const submit = await app.request("/v1/videos/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "mm-video", input: { prompt: "a data cat in motion" } }),
    });
    expect(submit.status).toBe(200);
    const body: any = await submit.json();
    expect(body.output.task_id).toBeTruthy();
    expect(["PENDING", "RUNNING"]).toContain(body.output.task_status);

    const poll = await app.request(`/v1/videos/generations/${body.output.task_id}`, {
      headers: { Authorization: auth.Authorization },
    });
    expect(poll.status).toBe(200);
    const pollBody: any = await poll.json();
    expect(pollBody.output.task_id).toBe(body.output.task_id);
    expect(["PENDING", "RUNNING", "SUCCEEDED"]).toContain(pollBody.output.task_status);
  });

  it("returns 404 for unknown image models", async () => {
    const res = await app.request("/v1/images/generations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "no-such-image-model", prompt: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("trial-aware dispatch", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM trial_quotas").run();
    db.prepare("DELETE FROM usage_daily").run();
    db.prepare("DELETE FROM request_logs").run();
    db.prepare("DELETE FROM key_groups").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM model_groups").run();
  });

  it("fails closed when every key's trial for the model is exhausted", async () => {
    const key = createKey({
      alias: "DashScope Trial",
      secret: "sk-trial-dispatch", key_type: "standard",
      region: "ap-southeast-1",
      base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      groups: ["paid-guard"],
    });
    seedTrialsForKey(key.id, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
    createGroup({
      id: "paid-guard",
      display_name: "Guard",
      candidates: [{ upstream_model_id: "qwen3.8-max", priority: 1, capabilities: ["chat"] }],
    });

    // Burn the whole trial, then request that model — must NOT silently use paid quota
    setTrialQuota(key.id, "qwen3.8-max", "tokens", 100, null);
    consumeTrialCall(key.id, "qwen3.8-max"); // no-op for tokens
    const db = getDb();
    db.prepare("UPDATE trial_quotas SET used = limit_amount WHERE api_key_id = ? AND model = ?").run(key.id, "qwen3.8-max");

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ model: "paid-guard", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    const body: any = await res.json();
    expect(body.error.code).toBe("trial_exhausted");
  });
});
