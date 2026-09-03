// Phase 0 Discovery Spike — DashScope API Compatibility Test
// Tests workspace-scoped keys (sk-ws-H.*) against their per-workspace hostnames.

const keys = {
  singapore: {
    id: 1128930,
    apiKey: "sk-ws-H.DDHYXIM.zbXP.MEYCIQDroKwkiJ0V5tZxU6sWFjLdLI8aTwFFtb1d6PCRi4M0TwIhAMje6n2LFN-r2b_oA1lKi7F4jkcU0aaR8qfvpwidkudG",
    base_url: "https://ws-4crao9rvi12yl8qx.ap-southeast-1.maas.aliyuncs.com",
  },
  beijing: {
    id: 6427779,
    apiKey: "sk-ws-H.ELHPPPX.nPyX.MEQCICgh410I8qLPHsGlK9e9XslUnokD2sxLF72p_Z1Wo307AiBu3g0t5HPOOtN6G0fK_oAj5E445RU67HyrVggWM0IsYg",
    base_url: "https://ws-l26tkq0l2fmwokky.cn-beijing.maas.aliyuncs.com",
  },
};

function headers(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function testModels(region, key) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: GET /compatible-mode/v1/models  [${region}]`);
  console.log(`${"=".repeat(60)}`);

  const url = `${key.base_url}/compatible-mode/v1/models`;
  try {
    const res = await fetch(url, { headers: headers(key.apiKey) });
    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(`Headers:`);
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase().includes("rate") || k.toLowerCase().includes("limit") || k.toLowerCase().includes("remaining")) {
        console.log(`  ${k}: ${v}`);
      }
    }
    const body = await res.json();
    console.log(`Models returned: ${body.data?.length ?? "N/A"}`);
    if (body.data) {
      const ids = body.data.map((m) => m.id).sort();
      console.log(`Model IDs (first 30):`);
      ids.slice(0, 30).forEach((id) => console.log(`  - ${id}`));
      if (ids.length > 30) console.log(`  ... and ${ids.length - 30} more`);
    }
    return { status: res.status, modelCount: body.data?.length ?? 0 };
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return { status: 0, error: e.message };
  }
}

async function testChatCompletions(region, key, stream = false) {
  const label = stream ? "streaming" : "non-stream";
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: POST /compatible-mode/v1/chat/completions [${region}] [${label}]`);
  console.log(`${"=".repeat(60)}`);

  const url = `${key.base_url}/compatible-mode/v1/chat/completions`;
  const body = {
    model: "qwen-plus",
    messages: [{ role: "user", content: "Say hello in one word." }],
    stream,
    max_tokens: 10,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(key.apiKey),
      body: JSON.stringify(body),
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(`Response headers:`);
    for (const [k, v] of res.headers.entries()) {
      console.log(`  ${k}: ${v}`);
    }

    if (stream) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let fullText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        fullText += text;
        chunks++;
      }
      console.log(`\nStream chunks received: ${chunks}`);
      console.log(`Stream data (first 500 chars):`);
      console.log(fullText.slice(0, 500));
    } else {
      const json = await res.json();
      console.log(`\nResponse body:`);
      console.log(JSON.stringify(json, null, 2));
    }

    return { status: res.status };
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return { status: 0, error: e.message };
  }
}

async function testChatWithAlias(region, key) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: POST chat with qwen-turbo model  [${region}]`);
  console.log(`${"=".repeat(60)}`);

  const url = `${key.base_url}/compatible-mode/v1/chat/completions`;
  const body = {
    model: "qwen-turbo",
    messages: [{ role: "user", content: "What is 2+2?" }],
    max_tokens: 20,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(key.apiKey),
      body: JSON.stringify(body),
    });
    console.log(`Status: ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.choices) {
      console.log(`Model in response: ${json.model}`);
      console.log(`Content: ${json.choices[0]?.message?.content}`);
      console.log(`Usage:`, JSON.stringify(json.usage));
    } else {
      console.log(JSON.stringify(json, null, 2));
    }
    return { status: res.status };
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return { status: 0, error: e.message };
  }
}

async function testEmbeddings(region, key) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: POST /compatible-mode/v1/embeddings  [${region}]`);
  console.log(`${"=".repeat(60)}`);

  const url = `${key.base_url}/compatible-mode/v1/embeddings`;
  const body = {
    model: "text-embedding-v3",
    input: "Hello world",
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(key.apiKey),
      body: JSON.stringify(body),
    });
    console.log(`Status: ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.data) {
      console.log(`Embedding dimensions: ${json.data[0]?.embedding?.length}`);
      console.log(`Model: ${json.model}`);
      console.log(`Usage:`, JSON.stringify(json.usage));
    } else {
      console.log(JSON.stringify(json, null, 2));
    }
    return { status: res.status };
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return { status: 0, error: e.message };
  }
}

async function testRateLimitHeaders(region, key) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: Rate limit header inspection  [${region}]`);
  console.log(`${"=".repeat(60)}`);

  const url = `${key.base_url}/compatible-mode/v1/chat/completions`;
  const body = {
    model: "qwen-turbo",
    messages: [{ role: "user", content: "Hi" }],
    max_tokens: 5,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(key.apiKey),
      body: JSON.stringify(body),
    });
    console.log(`Status: ${res.status}`);
    console.log(`\nAll response headers:`);
    for (const [k, v] of res.headers.entries()) {
      console.log(`  ${k}: ${v}`);
    }
    await res.json(); // consume body
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

async function main() {
  const results = {};

  for (const [region, key] of Object.entries(keys)) {
    console.log(`\n\n${"#".repeat(60)}`);
    console.log(`REGION: ${region}`);
    console.log(`Workspace: ${key.base_url}`);
    console.log(`Key prefix: ${key.apiKey.substring(0, 20)}...`);
    console.log(`${"#".repeat(60)}`);

    results[region] = {};
    results[region].models = await testModels(region, key);
    results[region].chatNonStream = await testChatCompletions(region, key, false);
    results[region].chatStream = await testChatCompletions(region, key, true);
    results[region].chatAlias = await testChatWithAlias(region, key);
    results[region].embeddings = await testEmbeddings(region, key);
    results[region].rateHeaders = await testRateLimitHeaders(region, key);
  }

  console.log(`\n\n${"=".repeat(60)}`);
  console.log("SUMMARY");
  console.log(`${"=".repeat(60)}`);
  for (const [region, r] of Object.entries(results)) {
    console.log(`\n${region}:`);
    for (const [test, data] of Object.entries(r)) {
      console.log(`  ${test}: status=${data.status}${data.error ? ` error="${data.error}"` : ""}${data.modelCount !== undefined ? ` models=${data.modelCount}` : ""}`);
    }
  }
}

main().catch(console.error);
