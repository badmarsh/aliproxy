\# Qwen Proxy — Technická špecifikácia



> Verzia: 0.1-draft | Dátum: september 2026



\---



\## 1. Prehľad projektu



\*\*Qwen Proxy\*\* je lokálna desktopová (alebo self-hosted) aplikácia, ktorá:



\- spravuje jeden alebo viacero DashScope/Qwen API kľúčov,

\- načítava zoznam dostupných modelov z upstream endpointu vrátane zostatkových kvót,

\- umožňuje zaradiť modely do pomenovaných skupín (napr. `qwen-max`, `qwen-plus`, `qwen-coder`),

\- spúšťa lokálny HTTP server kompatibilný s OpenAI API,

\- routuje každý prichádzajúci request na správny upstream model podľa nakonfigurovaných pravidiel.



Inšpirácia: \[Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) — multi-account AI proxy s dashboardom, model routerom a smart schedulingom.



\---



\## 2. Rozsah (Scope)



| Zahrnuté v MVP | Mimo MVP (future) |

|---|---|

| Správa API kľúčov (add / edit / delete) | Multi-user / team features |

| Načítanie modelov a kvót z DashScope | Web UI prístupné cez internet |

| Skupiny modelov s vlastným alias názvom | Platobný modul / billing overview |

| Lokálny OpenAI-kompatibilný endpoint | Plugin systém |

| Základný model router (group → model) | gRPC podpora |

| Live dashboard (quota, latency, RPS) | Prometheus / Grafana export |

| Docker deployment | Mobile app |



\---



\## 3. Architektúra



```

┌─────────────────────────────────────────────────────────────┐

│                     Klientske aplikácie                     │

│   (Claude Code, Cursor, OpenCode, Python SDK, curl, …)      │

└────────────────────────┬────────────────────────────────────┘

&#x20;                        │ HTTP/SSE  OpenAI-compatible API

&#x20;                        ▼

┌─────────────────────────────────────────────────────────────┐

│                    Qwen Proxy Core                           │

│                                                             │

│  ┌──────────┐  ┌───────────┐  ┌──────────────────────────┐ │

│  │  Auth    │  │  Router   │  │   Quota Guard            │ │

│  │  Layer   │→ │  Engine   │→ │   (rate-limit aware)     │ │

│  └──────────┘  └───────────┘  └──────────────────────────┘ │

│                      │                                      │

│               ┌──────▼──────┐                              │

│               │  Dispatcher │  (round-robin / weighted /   │

│               │             │   least-quota)               │

│               └──────┬──────┘                              │

│                      │                                      │

│  ┌───────────────────▼─────────────────────────────────┐   │

│  │              Key Store                               │   │

│  │  key-1: sk-xxx  \[qwen-max, qwen-plus]  quota: 85%   │   │

│  │  key-2: sk-yyy  \[qwen-coder]           quota: 42%   │   │

│  └──────────────────────────────────────────────────────┘   │

└──────────────────────────┬──────────────────────────────────┘

&#x20;                          │ HTTPS

&#x20;                          ▼

┌─────────────────────────────────────────────────────────────┐

│           Alibaba Cloud DashScope                            │

│   https://dashscope.aliyuncs.com/compatible-mode/v1         │

└─────────────────────────────────────────────────────────────┘

```



\### 3.1 Komponenty



| Komponent | Zodpovednosť |

|---|---|

| \*\*HTTP Gateway\*\* | Prijíma požiadavky, overuje proxy API kľúč klienta |

| \*\*Auth Layer\*\* | Validuje `Authorization: Bearer <proxy-key>` hlavičku |

| \*\*Router Engine\*\* | Mapuje príchodzí model name → skupinu → upstream model |

| \*\*Quota Guard\*\* | Blokuje / rotuje kľúče keď zostatok padne pod threshold |

| \*\*Dispatcher\*\* | Vyberá konkrétny API kľúč pre daný request |

| \*\*Key Store\*\* | Perzistentné uloženie kľúčov, kvót, skupín |

| \*\*Sync Worker\*\* | Periodicky refreshuje kvóty z DashScope |

| \*\*Web UI\*\* | Dashboard, konfigurácia (React/SvelteKit) |



\---



\## 4. Funkcionality



\### 4.1 Správa API kľúčov



\*\*F-KEY-01\*\* Pridať nový API kľúč (manuálne zadanie `sk-…` reťazca).  

\*\*F-KEY-02\*\* Pomenovať kľúč (alias pre orientáciu).  

\*\*F-KEY-03\*\* Priradiť kľúč k jednej alebo viacerým skupinám modelov.  

\*\*F-KEY-04\*\* Zobraziť stav kľúča: `active` / `quota\_exhausted` / `invalid` / `rate\_limited`.  

\*\*F-KEY-05\*\* Odobrať alebo deaktivovať kľúč bez zmazania histórie.  

\*\*F-KEY-06\*\* Batch import kľúčov cez JSON alebo newline-separated text.  

\*\*F-KEY-07\*\* Exportovať kľúče (zašifrované, pre zálohu).



\### 4.2 Načítanie modelov a kvót



\*\*F-MDL-01\*\* Po pridaní kľúča automaticky zavolať DashScope endpoint a stiahnuť zoznam dostupných modelov.



```

GET https://dashscope.aliyuncs.com/compatible-mode/v1/models

Authorization: Bearer {api\_key}

```



\*\*F-MDL-02\*\* Pre každý model stiahnuť dostupnú kvótu / usage (ak DashScope endpoint poskytuje).



```

GET https://dashscope.aliyuncs.com/api/v1/services/aigc/usage

Authorization: Bearer {api\_key}

```



\*\*F-MDL-03\*\* Periodický refresh kvót — konfigurovateľný interval (default: 5 min).  

\*\*F-MDL-04\*\* Manuálny refresh tlačidlom v UI.  

\*\*F-MDL-05\*\* Zobraziť `last\_refreshed\_at` timestamp pri každom kľúči / modeli.  

\*\*F-MDL-06\*\* Upozorniť (badge / toast) keď kvóta klesne pod konfigurovateľný prah (default: 20 %).



\*\*Dátová štruktúra modelu po načítaní:\*\*



```json

{

&#x20; "id": "qwen-max",

&#x20; "object": "model",

&#x20; "owned\_by": "alibaba",

&#x20; "context\_length": 32768,

&#x20; "quota": {

&#x20;   "rpm\_limit": 60,

&#x20;   "rpm\_used": 12,

&#x20;   "tpm\_limit": 300000,

&#x20;   "tpm\_used": 45000,

&#x20;   "remaining\_fraction": 0.85

&#x20; }

}

```



\### 4.3 Skupiny modelov (Model Groups)



\*\*F-GRP-01\*\* Vytvoriť skupinu s vlastným názvom (napr. `qwen-max`, `qwen-plus`, `qwen-coder`, `multimodal`, `embedding`).  

\*\*F-GRP-02\*\* Priradiť jeden alebo viac konkrétnych upstream modelov do skupiny.  

\*\*F-GRP-03\*\* Nastaviť alias — externý názov modelu, ktorý klienti posielajú (napr. `gpt-4o` → skupina `qwen-max`).  

\*\*F-GRP-04\*\* Nastaviť stratégiu výberu modelu v skupine: `round-robin` | `least-quota` | `weighted` | `first-available`.  

\*\*F-GRP-05\*\* Zobraziť agregovanú kvótu skupiny (súhrn všetkých kľúčov priradených k skupine).  

\*\*F-GRP-06\*\* Zakázať skupinu (všetky requesty na túto skupinu vrátia 503).



\*\*Predefinované skupiny (navrhované):\*\*



| Skupina | Modely | Alias príklady |

|---|---|---|

| `qwen-max` | qwen-max, qwen-max-longcontext | gpt-4o, claude-opus |

| `qwen-plus` | qwen-plus, qwen-plus-latest | gpt-4o-mini |

| `qwen-turbo` | qwen-turbo, qwen-turbo-latest | gpt-3.5-turbo |

| `qwen-coder` | qwen2.5-coder-32b-instruct | gpt-4-turbo |

| `qwen-math` | qwen2.5-math-72b-instruct | — |

| `qwen-vl` | qwen-vl-max, qwen-vl-plus | gpt-4-vision-preview |

| `qwen-audio` | qwen-audio-turbo | — |

| `embedding` | text-embedding-v3 | text-embedding-ada-002 |



\### 4.4 Lokálny proxy endpoint



\*\*F-SRV-01\*\* Spustiť lokálny HTTP server na konfigurovateľnom porte (default: `11434` alebo `8080`).  

\*\*F-SRV-02\*\* Exponovať OpenAI-kompatibilné endpointy:



```

POST /v1/chat/completions       — chat, streaming (SSE)

POST /v1/completions            — legacy completions

POST /v1/embeddings             — embedding vektory

GET  /v1/models                 — zoznam dostupných skupín ako "modely"

GET  /health                    — health check

GET  /metrics                   — usage štatistiky (JSON)

```



\*\*F-SRV-03\*\* Podpora `stream: true` cez SSE (Server-Sent Events).  

\*\*F-SRV-04\*\* Proxy API kľúč — klienti sa autentifikujú voči proxy vlastným kľúčom (nie DashScope kľúčom).  

\*\*F-SRV-05\*\* Konfigurovateľný `Access-Control-Allow-Origin` pre lokálnych webových klientov.  

\*\*F-SRV-06\*\* Voliteľné TLS (self-signed cert alebo custom cert).  

\*\*F-SRV-07\*\* Request / response logging s voliteľnou anonymizáciou payloadu.



\### 4.5 Request routing



\*\*F-RTE-01\*\* Klient pošle request s `model: "qwen-max"` → proxy ho smeruje do skupiny `qwen-max`.  

\*\*F-RTE-02\*\* Klient pošle request s `model: "gpt-4o"` → alias lookup → skupina `qwen-max` (ak nakonfigurovaný alias).  

\*\*F-RTE-03\*\* Ak klient pošle neznámy model name → vrátiť 404 alebo smerovať na default skupinu (konfigurovateľné).  

\*\*F-RTE-04\*\* Dispatcher vyberie konkrétny API kľúč podľa stratégie skupiny.  

\*\*F-RTE-05\*\* Ak vybraný kľúč vráti 429 (rate limit) → automaticky retry s iným kľúčom v rámci skupiny.  

\*\*F-RTE-06\*\* Ak všetky kľúče v skupiny sú vyčerpané → vrátiť `503 Service Unavailable` so správou.  

\*\*F-RTE-07\*\* Voliteľný \*\*model fallback chain\*\*: `qwen-max` → `qwen-plus` → `qwen-turbo` (na základe priority).  

\*\*F-RTE-08\*\* Header passthrough: zachovať pôvodné hlavičky klienta (okrem `Authorization`).



\*\*Routing pipeline:\*\*



```

\[Request]

&#x20;  ↓

\[Auth check: proxy API key]

&#x20;  ↓

\[Model name lookup: alias? → group?]

&#x20;  ↓

\[Group dispatcher: select API key by strategy]

&#x20;  ↓

\[Quota guard: quota > threshold?]

&#x20;  ↓ YES                    ↓ NO

\[Forward to DashScope]   \[Try next key / 503]

&#x20;  ↓

\[Response transform: normalize to OpenAI format]

&#x20;  ↓

\[Update quota cache]

&#x20;  ↓

\[Return to client]

```



\### 4.6 Dashboard (Web UI)



\*\*F-UI-01\*\* Prehľad všetkých kľúčov so stave a kvótou (progress bar).  

\*\*F-UI-02\*\* Prehľad skupín — aggregovaná kvóta, počet kľúčov, aktuálne RPS.  

\*\*F-UI-03\*\* Live request log — posledné N requestov s modelom, latenciou, status kódom.  

\*\*F-UI-04\*\* Grafy (posledných 24h): počet requestov, priemerná latencia, top modely.  

\*\*F-UI-05\*\* Proxy server ovládanie: Start / Stop tlačidlo, aktuálny port.  

\*\*F-UI-06\*\* Nastavenia: refresh interval, quota threshold, default group, proxy port, proxy API key.  

\*\*F-UI-07\*\* Dark / Light mode.



\---



\## 5. Technický stack (navrhovaný)



\### Možnosť A — Tauri v2 + React (inšpirované Antigravity-Manager)



| Vrstva | Technológia |

|---|---|

| Desktop shell | Tauri v2 (Rust backend) |

| UI framework | React 19 + TypeScript |

| Styling | Tailwind CSS v4 |

| HTTP proxy server | Rust `axum` (vstavané do Tauri backendu) |

| State management | Zustand |

| Charts | Recharts alebo Chart.js |

| Perzistencia | SQLite cez `rusqlite` |

| Config | TOML (`\~/.qwen-proxy/config.toml`) |



\### Možnosť B — Node.js + Electron (ľahší dev stack)



| Vrstva | Technológia |

|---|---|

| Desktop shell | Electron 33 |

| HTTP proxy server | Fastify alebo Hono |

| UI | React + Vite |

| Perzistencia | better-sqlite3 |

| Config | JSON / YAML |



\### Možnosť C — Headless (Docker only)



Pre serverové nasadenie bez UI — čisto Node.js / Rust HTTP server + voliteľné Web UI na samostatnom porte.



\*\*Odporúčanie pre MVP:\*\* Možnosť C (headless) je najrýchlejšia na implementáciu. Možnosť A dáva najlepší UX.



\---



\## 6. Dátový model



\### 6.1 ApiKey



```typescript

interface ApiKey {

&#x20; id: string;               // UUID

&#x20; alias: string;            // "Osobný kľúč #1"

&#x20; secret: string;           // zašifrované, nikdy plaintext v DB

&#x20; groups: string\[];         // \["qwen-max", "qwen-plus"]

&#x20; status: "active" | "quota\_exhausted" | "invalid" | "rate\_limited" | "disabled";

&#x20; models: ModelInfo\[];      // stiahnuté z DashScope

&#x20; last\_quota\_refresh: Date;

&#x20; created\_at: Date;

}

```



\### 6.2 ModelInfo



```typescript

interface ModelInfo {

&#x20; model\_id: string;         // "qwen-max"

&#x20; display\_name: string;     // "Qwen Max"

&#x20; context\_length: number;

&#x20; supports\_streaming: boolean;

&#x20; supports\_vision: boolean;

&#x20; supports\_tools: boolean;

&#x20; quota: ModelQuota;

}



interface ModelQuota {

&#x20; rpm\_limit: number | null;

&#x20; rpm\_remaining: number | null;

&#x20; tpm\_limit: number | null;

&#x20; tpm\_remaining: number | null;

&#x20; daily\_limit: number | null;

&#x20; daily\_used: number | null;

&#x20; remaining\_fraction: number;  // 0.0 - 1.0

&#x20; refreshed\_at: Date;

}

```



\### 6.3 ModelGroup



```typescript

interface ModelGroup {

&#x20; id: string;               // "qwen-max"

&#x20; display\_name: string;     // "Qwen Max (Premium)"

&#x20; aliases: string\[];        // \["gpt-4o", "claude-opus-4"]

&#x20; upstream\_models: string\[]; // \["qwen-max", "qwen-max-longcontext"]

&#x20; key\_ids: string\[];        // priradené API kľúče

&#x20; strategy: "round-robin" | "least-quota" | "weighted" | "first-available";

&#x20; weights: Record<string, number>; // key\_id → weight (pre weighted stratégiu)

&#x20; fallback\_group: string | null;   // skupina na fallback

&#x20; enabled: boolean;

&#x20; created\_at: Date;

}

```



\### 6.4 RequestLog



```typescript

interface RequestLog {

&#x20; id: string;

&#x20; timestamp: Date;

&#x20; client\_ip: string;

&#x20; requested\_model: string;  // čo klient požadoval

&#x20; resolved\_group: string;   // skupina

&#x20; upstream\_model: string;   // skutočný model

&#x20; api\_key\_id: string;

&#x20; status\_code: number;

&#x20; latency\_ms: number;

&#x20; prompt\_tokens: number;

&#x20; completion\_tokens: number;

&#x20; streaming: boolean;

&#x20; error: string | null;

}

```



\### 6.5 ProxyConfig



```typescript

interface ProxyConfig {

&#x20; port: number;              // default: 8080

&#x20; host: string;              // default: "127.0.0.1"

&#x20; proxy\_api\_key: string;     // kľúč ktorý klienti posielajú

&#x20; tls\_enabled: boolean;

&#x20; tls\_cert\_path: string | null;

&#x20; tls\_key\_path: string | null;

&#x20; cors\_origins: string\[];

&#x20; quota\_refresh\_interval\_seconds: number;  // default: 300

&#x20; quota\_warning\_threshold: number;         // default: 0.2

&#x20; default\_group: string | null;

&#x20; log\_requests: boolean;

&#x20; log\_payload: boolean;      // false = anonymizovať

&#x20; max\_request\_log\_count: number;           // default: 1000

}

```



\---



\## 7. API Endpointy (proxy exposes)



\### POST /v1/chat/completions



Identický s OpenAI API. `model` field sa prelookupuje cez alias/group router.



```json

// Request (od klienta)

{

&#x20; "model": "qwen-max",

&#x20; "messages": \[{"role": "user", "content": "Hello"}],

&#x20; "stream": false,

&#x20; "temperature": 0.7

}



// Response (od proxy, normalizovaná z DashScope)

{

&#x20; "id": "chatcmpl-xxx",

&#x20; "object": "chat.completion",

&#x20; "model": "qwen-max",          // ← vrátený group alias, nie upstream ID

&#x20; "choices": \[...],

&#x20; "usage": {...},

&#x20; "x-qwen-proxy": {             // extension hlavičky

&#x20;   "upstream\_model": "qwen-max-2025-01-25",

&#x20;   "api\_key\_alias": "Key #1",

&#x20;   "latency\_ms": 342

&#x20; }

}

```



\### GET /v1/models



Vracia zoznam skupín ako "modely" (pre kompatibilitu s OpenAI):



```json

{

&#x20; "object": "list",

&#x20; "data": \[

&#x20;   { "id": "qwen-max",   "object": "model", "owned\_by": "qwen-proxy" },

&#x20;   { "id": "qwen-plus",  "object": "model", "owned\_by": "qwen-proxy" },

&#x20;   { "id": "qwen-coder", "object": "model", "owned\_by": "qwen-proxy" },

&#x20;   { "id": "gpt-4o",     "object": "model", "owned\_by": "qwen-proxy" }

&#x20; ]

}

```



\### GET /health



```json

{ "status": "ok", "uptime\_seconds": 3600, "proxy\_version": "1.0.0" }

```



\### GET /metrics



```json

{

&#x20; "total\_requests": 1523,

&#x20; "requests\_last\_hour": 87,

&#x20; "avg\_latency\_ms": 412,

&#x20; "groups": {

&#x20;   "qwen-max": { "requests": 450, "quota\_fraction": 0.72 },

&#x20;   "qwen-plus": { "requests": 890, "quota\_fraction": 0.41 }

&#x20; }

}

```



\---



\## 8. Interné správcovské API (Web UI backend)



```

\# API kľúče

GET    /api/keys

POST   /api/keys

PUT    /api/keys/:id

DELETE /api/keys/:id

POST   /api/keys/:id/refresh-quota

POST   /api/keys/import



\# Skupiny

GET    /api/groups

POST   /api/groups

PUT    /api/groups/:id

DELETE /api/groups/:id



\# Modely (načítané z upstream)

GET    /api/models                  — všetky modely cez všetky kľúče



\# Proxy server

GET    /api/proxy/status

POST   /api/proxy/start

POST   /api/proxy/stop

GET    /api/proxy/config

PUT    /api/proxy/config



\# Logy

GET    /api/logs?limit=50\&group=qwen-max



\# Štatistiky

GET    /api/stats/summary

GET    /api/stats/timeline?hours=24

```



\---



\## 9. Konfiguračný súbor



Umiestnenie: `\~/.qwen-proxy/config.toml`



```toml

\[proxy]

port = 8080

host = "127.0.0.1"

proxy\_api\_key = "sk-proxy-xxxxxxxxxxxxx"

quota\_refresh\_interval\_seconds = 300

quota\_warning\_threshold = 0.20

log\_requests = true

log\_payload = false



\[proxy.tls]

enabled = false

\# cert\_path = "/path/to/cert.pem"

\# key\_path  = "/path/to/key.pem"



\[\[keys]]

id = "key-1"

alias = "Firemný kľúč"

\# secret uložený zašifrovane v keystore, nie tu

groups = \["qwen-max", "qwen-plus", "qwen-coder"]

enabled = true



\[\[groups]]

id = "qwen-max"

display\_name = "Qwen Max"

aliases = \["gpt-4o", "claude-opus-4"]

upstream\_models = \["qwen-max", "qwen-max-longcontext"]

strategy = "least-quota"

fallback\_group = "qwen-plus"

enabled = true



\[\[groups]]

id = "qwen-coder"

display\_name = "Qwen Coder"

aliases = \["gpt-4-turbo"]

upstream\_models = \["qwen2.5-coder-32b-instruct"]

strategy = "round-robin"

enabled = true

```



\---



\## 10. Bezpečnosť



| Riziko | Opatrenie |

|---|---|

| Únik API kľúčov | Kľúče uložené zašifrované (AES-256-GCM), plaintext iba v pamäti počas requestu |

| Neoprávnený prístup k proxy | Proxy API kľúč povinný pre každý request |

| Prístup k Web UI | Voliteľné Web UI heslo (oddelené od proxy kľúča) |

| Path traversal (config) | Validácia všetkých file path inputov |

| Request payload logging | Štandardne vypnuté, ak zapnuté — upozornenie v UI |

| CORS | Whitelist povolených origínov, default: iba localhost |

| Šifrovaný transport | Voliteľné TLS; ak vypnuté, len localhost binding |



\---



\## 11. Plán implementácie (navrhovaný)



\### Fáza 1 — Základ (2 týždne)

\- \[ ] Key Store (add / edit / delete / encrypt)

\- \[ ] DashScope model fetch (`/v1/models`)

\- \[ ] Základný HTTP proxy server (chat/completions, streaming)

\- \[ ] Model group konfigurácia (TOML)

\- \[ ] Round-robin dispatcher



\### Fáza 2 — Kvóty a routing (2 týždne)

\- \[ ] Quota fetch + periodicý refresh

\- \[ ] Quota Guard + 429 retry logika

\- \[ ] Alias lookup

\- \[ ] Fallback chain

\- \[ ] Request logging



\### Fáza 3 — Web UI (2 týždne)

\- \[ ] Dashboard (key list, group list, live log)

\- \[ ] Quota grafy (24h timeline)

\- \[ ] Proxy Start/Stop ovládanie

\- \[ ] Settings stránka



\### Fáza 4 — Hardening + Docker (1 týždeň)

\- \[ ] TLS podpora

\- \[ ] Šifrovaný export/import kľúčov

\- \[ ] Docker image + compose

\- \[ ] README + inštalačný script



\---



\## 12. Príklady použitia



\### Claude Code CLI cez Qwen Proxy



```bash

export OPENAI\_API\_KEY="sk-proxy-moj-lokalny-kluc"

export OPENAI\_BASE\_URL="http://127.0.0.1:8080/v1"

\# namiesto qwen-max môžeš poslať aj "gpt-4o" ak alias nastavený

claude --model qwen-max "Napíš unit test pre túto funkciu"

```



\### Python SDK



```python

from openai import OpenAI



client = OpenAI(

&#x20;   api\_key="sk-proxy-moj-lokalny-kluc",

&#x20;   base\_url="http://127.0.0.1:8080/v1"

)



response = client.chat.completions.create(

&#x20;   model="qwen-coder",   # → skupina → qwen2.5-coder-32b-instruct

&#x20;   messages=\[{"role": "user", "content": "Hello!"}]

)

```



\### curl



```bash

curl http://localhost:8080/v1/chat/completions \\

&#x20; -H "Authorization: Bearer sk-proxy-moj-lokalny-kluc" \\

&#x20; -H "Content-Type: application/json" \\

&#x20; -d '{

&#x20;   "model": "gpt-4o",

&#x20;   "messages": \[{"role":"user","content":"Hi"}],

&#x20;   "stream": false

&#x20; }'

```



\---



\## 13. Otvorené otázky



1\. \*\*DashScope quota endpoint\*\* — DashScope nemá verejne zdokumentovaný štandardný quota endpoint. Treba preskúmať či je dostupný cez Alibaba Cloud Console API alebo response headers (`X-RateLimit-\*`).



2\. \*\*Viacero Alibaba Cloud regionov\*\* — DashScope má endpointy pre rôzne regióny (CN, International). Treba riešiť konfigurovateľnosť base URL.



3\. \*\*Multimodal routing\*\* — VL (vision) a Audio modely majú iný payload formát. Či proxy transparentne pasuje alebo transformuje?



4\. \*\*Desktop vs. headless-first\*\* — Tauri desktopová app vs. Docker-first headless server s Web UI. Odporúčam začať headless (jednoduchšie CI/CD), desktop shell pridať neskôr.



5\. \*\*Billing / cost tracking\*\* — DashScope účtuje per token. Pridať cost estimation (input/output cena × token count)?



\---



\*Koniec dokumentu. Verzia 0.1-draft.\*

