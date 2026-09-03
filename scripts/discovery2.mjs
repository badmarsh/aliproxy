// Phase 0 — Round 2: try more Singapore workspace keys for active chat quota
// Also capture full model list from a working key

const keys = [
  {
    name: "1012950",
    apiKey: "sk-ws-H.DMDHXRM.MHhH.MEQCIGcl7DGzS6cKqGxM2KgiUGQ4EtOkRXQMIZTRb9h97LZIAiB2KSnWxSOC_QFWs2s1ywpM9bvuhK2pbkp2EoCSCVwZKw",
    base_url: "https://ws-on1x9ancpww935ey.ap-southeast-1.maas.aliyuncs.com",
  },
  {
    name: "1090048",
    apiKey: "sk-ws-H.DMXMMLY.vVm6.MEQCIBTB3VsrbBmD1DM6CrTKk4mU33yvKITwp3ILusgUDluHAiAX6OcACmKlbq9WUsvyPfFRNX4s9EVaIHVm-NDbhe_wKg",
    base_url: "https://ws-fh5ya3b9mq2wj4oq.ap-southeast-1.maas.aliyuncs.com",
  },
  {
    name: "1094150",
    apiKey: "sk-ws-H.DMXLDRM.oP9s.MEYCIQDhSsXq_cv9Q8bQrQZtxkLwLv_vPajaBXjU8g9uFwj6nQIhANtKkgL18e9BCHGvW5NnWl2n2rS-dF4HcoJo-sdjbKRX",
    base_url: "https://llm-ug99w7v2d6hsbf9a.ap-southeast-1.maas.aliyuncs.com",
  },
  {
    name: "1090351",
    apiKey: "sk-ws-H.DMXMIRD.QMzb.MEUCICcLov1wtSzWqr_IqyGStQlnp2CqGvvqRug3mbBMuEWIAiEAxsuQf1lcltbiBGDHV4YOZFi005H4WXdWoUc-9acTja0",
    base_url: "https://ws-fh5ya3b9mq2wj4oq.ap-southeast-1.maas.aliyuncs.com",
  },
  {
    name: "1008918",
    apiKey: "sk-ws-H.DMMYXDY.Qmdi.MEUCIQC-JKXFdiEyS2_QjYw3EoJGvbcQ1PCUREtZXM8UwKl96wIgBpR9p1RXMZkRj2JCFl9Z41-19rFYD8ac6ZcA3T15nUg",
    base_url: "https://ws-f8e40sx404di063c.ap-southeast-1.maas.aliyuncs.com",
  },
  {
    name: "1128690",
    apiKey: "sk-ws-H.DDHYEXM.6iJI.MEQCICgh410I8qLPHsGlK9e9XslUnokD2sxLF72p_Z1Wo307AiBu3g0t5HPOOtN6G0fK_oAj5E445RU67HyrVggWM0IsYg",
    base_url: "https://ws-lk6r9226lvmvsazr.ap-southeast-1.maas.aliyuncs.com",
  },
  {
    name: "988172",
    apiKey: "sk-ws-H.XYYCPH.G2r6.MEUCIQCBq7Jqj4p9EBdJRztbOTdKuVooW1k7yPmIcZqCpM-ZsgIgUOnTQB0Gfli489bwVDdfuAMILQdNAC8e0OPzmb4HsXU",
    base_url: "https://ws-if9ngx52b21djj3e.ap-southeast-1.maas.aliyuncs.com",
  },
];

async function quickTest(key) {
  const url = `${key.base_url}/compatible-mode/v1/chat/completions`;
  const body = {
    model: "qwen-turbo",
    messages: [{ role: "user", content: "Say hi" }],
    max_tokens: 5,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const headers = {};
    for (const [k, v] of res.headers.entries()) headers[k] = v;

    let responseBody;
    if (res.status === 200) {
      responseBody = await res.json();
    } else {
      const text = await res.text();
      try { responseBody = JSON.parse(text); } catch { responseBody = text; }
    }

    return { status: res.status, headers, body: responseBody };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

async function main() {
  for (const key of keys) {
    process.stdout.write(`Key ${key.name}... `);
    const result = await quickTest(key);
    if (result.status === 200) {
      console.log(`✅ 200 OK — ${result.body.choices?.[0]?.message?.content}`);
      console.log(`  Model: ${result.body.model}, Usage: ${JSON.stringify(result.body.usage)}`);
    } else if (result.body?.error?.code) {
      console.log(`❌ ${result.status} — ${result.body.error.code}: ${result.body.error.message?.slice(0, 80)}`);
    } else {
      console.log(`❌ ${result.status} — ${JSON.stringify(result.body).slice(0, 100)}`);
    }
  }

  // Also get full model list from the first working key
  console.log(`\n--- Full model list from key 1128930 (Singapore) ---`);
  const key = {
    apiKey: "sk-ws-H.DDHYXIM.zbXP.MEYCIQDroKwkiJ0V5tZxU6sWFjLdLI8aTwFFtb1d6PCRi4M0TwIhAMje6n2LFN-r2b_oA1lKi7F4jkcU0aaR8qfvpwidkudG",
    base_url: "https://ws-4crao9rvi12yl8qx.ap-southeast-1.maas.aliyuncs.com",
  };
  const res = await fetch(`${key.base_url}/compatible-mode/v1/models`, {
    headers: { Authorization: `Bearer ${key.apiKey}` },
  });
  const data = await res.json();
  const models = data.data?.map(m => m.id).sort() ?? [];
  console.log(`Total: ${models.length} models\n`);
  models.forEach(m => console.log(`  ${m}`));
}

main().catch(console.error);
