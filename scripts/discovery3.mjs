// Phase 0 — Round 3: comprehensive tests with working key 1128690
const KEY = {
  name: "1128690",
  apiKey: "sk-ws-H.DDHYEXM.6iJI.MEQCICgh410I8qLPHsGlK9e9XslUnokD2sxLF72p_Z1Wo307AiBu3g0t5HPOOtN6G0fK_oAj5E445RU67HyrVggWM0IsYg",
  base_url: "https://ws-lk6r9226lvmvsazr.ap-southeast-1.maas.aliyuncs.com",
};

const H = { Authorization: `Bearer ${KEY.apiKey}`, "Content-Type": "application/json" };

async function chat(model, opts = {}) {
  const url = `${KEY.base_url}/compatible-mode/v1/chat/completions`;
  const body = {
    model,
    messages: opts.messages || [{ role: "user", content: "Say exactly: hello world" }],
    max_tokens: opts.max_tokens || 10,
    ...(opts.stream ? { stream: true } : {}),
  };
  const res = await fetch(url, { method: "POST", headers: H, body: JSON.stringify(body) });
  return res;
}

async function allHeaders(res) {
  const h = {};
  for (const [k, v] of res.headers.entries()) h[k] = v;
  return h;
}

// --- Test 1: Non-stream with multiple models ---
console.log("=== Test 1: Non-stream across multiple models ===\n");
const models = ["qwen-turbo", "qwen-plus", "qwen-max", "qwen3-coder-plus"];
for (const model of models) {
  process.stdout.write(`${model}: `);
  try {
    const res = await chat(model);
    const headers = await allHeaders(res);
    if (res.status === 200) {
      const json = await res.json();
      console.log(`✅ 200 — model="${json.model}" content="${json.choices[0].message.content.trim().slice(0, 40)}" usage=${JSON.stringify(json.usage)}`);
    } else {
      const text = await res.text();
      let code;
      try { code = JSON.parse(text).error?.code; } catch { code = text.slice(0, 80); }
      console.log(`❌ ${res.status} — ${code}`);
    }
    // Print rate-limit headers if present
    const rlKeys = Object.keys(headers).filter(k => k.toLowerCase().includes("rate") || k.toLowerCase().includes("limit") || k.toLowerCase().includes("remaining"));
    if (rlKeys.length > 0) {
      console.log(`  Rate-limit headers: ${rlKeys.map(k => `${k}=${headers[k]}`).join(", ")}`);
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

// --- Test 2: SSE Streaming ---
console.log("\n=== Test 2: SSE Streaming ===\n");
const streamRes = await chat("qwen-turbo", { stream: true, max_tokens: 30 });
console.log(`Status: ${streamRes.status}`);
console.log(`Content-Type: ${streamRes.headers.get("content-type")}`);

const reader = streamRes.body.getReader();
const decoder = new TextDecoder();
let chunkCount = 0;
let fullData = "";
const t0 = Date.now();
let firstByteTime = null;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value, { stream: true });
  if (firstByteTime === null) firstByteTime = Date.now() - t0;
  fullData += text;
  chunkCount++;
}

console.log(`Total time: ${Date.now() - t0}ms`);
console.log(`TTFT (time to first chunk): ${firstByteTime}ms`);
console.log(`Chunks: ${chunkCount}`);
console.log(`\nStream data (first 1000 chars):\n${fullData.slice(0, 1000)}`);
console.log(`\nStream data (last 500 chars):\n${fullData.slice(-500)}`);

// --- Test 3: Full response headers ---
console.log("\n=== Test 3: Full response headers (non-stream) ===\n");
const headerRes = await chat("qwen-turbo");
const headers = await allHeaders(headerRes);
await headerRes.json(); // consume
console.log("All headers:");
for (const [k, v] of Object.entries(headers).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${k}: ${v}`);
}

// --- Test 4: Invalid model ---
console.log("\n=== Test 4: Invalid model name ===\n");
const invalidRes = await chat("nonexistent-model-xyz");
console.log(`Status: ${invalidRes.status}`);
const invalidBody = await invalidRes.json();
console.log(`Error: ${JSON.stringify(invalidBody.error)}`);

// --- Test 5: Vision model ---
console.log("\n=== Test 5: Vision model (qwen-vl-plus) ===\n");
const visionRes = await fetch(`${KEY.base_url}/compatible-mode/v1/chat/completions`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    model: "qwen-vl-plus",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "What color is the sky?" },
      ],
    }],
    max_tokens: 20,
  }),
});
console.log(`Status: ${visionRes.status}`);
const visionBody = await visionRes.json();
if (visionBody.choices) {
  console.log(`Content: ${visionBody.choices[0].message.content}`);
} else {
  console.log(`Error: ${JSON.stringify(visionBody.error)}`);
}

// --- Test 6: Embeddings ---
console.log("\n=== Test 6: Embeddings (text-embedding-v3, v4) ===\n");
for (const embModel of ["text-embedding-v3", "text-embedding-v4"]) {
  process.stdout.write(`${embModel}: `);
  const embRes = await fetch(`${KEY.base_url}/compatible-mode/v1/embeddings`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ model: embModel, input: ["hello world", "test embedding"] }),
  });
  console.log(`Status: ${embRes.status}`);
  if (embRes.status === 200) {
    const embBody = await embRes.json();
    console.log(`  Dimensions: ${embBody.data[0].embedding.length}`);
    console.log(`  Model: ${embBody.model}`);
    console.log(`  Usage: ${JSON.stringify(embBody.usage)}`);
  } else {
    const text = await embRes.text();
    console.log(`  Error: ${text.slice(0, 200)}`);
  }
}

// --- Test 7: Tools/function calling ---
console.log("\n=== Test 7: Function calling (tools) ===\n");
const toolsRes = await fetch(`${KEY.base_url}/compatible-mode/v1/chat/completions`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    model: "qwen-plus",
    messages: [{ role: "user", content: "What's the weather in Paris?" }],
    tools: [{
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a city",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    }],
    max_tokens: 50,
  }),
});
console.log(`Status: ${toolsRes.status}`);
const toolsBody = await toolsRes.json();
if (toolsBody.choices) {
  const msg = toolsBody.choices[0].message;
  console.log(`Tool calls: ${JSON.stringify(msg.tool_calls)}`);
  console.log(`Content: ${msg.content}`);
} else {
  console.log(`Error: ${JSON.stringify(toolsBody.error)}`);
}

// --- Test 8: Concurrent requests (mini load test) ---
console.log("\n=== Test 8: 5 concurrent requests ===\n");
const t1 = Date.now();
const results = await Promise.all(
  Array.from({ length: 5 }, (_, i) =>
    chat("qwen-turbo").then(async (res) => {
      const h = await allHeaders(res);
      const body = await res.json();
      return { i, status: res.status, ok: res.status === 200, requestId: h["x-request-id"] };
    }).catch((e) => ({ i, error: e.message }))
  )
);
console.log(`Total time: ${Date.now() - t1}ms`);
results.forEach(r => {
  if (r.error) console.log(`  #${r.i}: ERROR ${r.error}`);
  else console.log(`  #${r.i}: ${r.status} ${r.ok ? "✅" : "❌"} reqId=${r.requestId}`);
});

console.log("\n=== DONE ===");
