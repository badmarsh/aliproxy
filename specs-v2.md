# Qwen Proxy — Technická špecifikácia

> **Verzia:** 0.4 · **Dátum:** september 2026
> **Stav:** Fáza 1 aktívna · **Primárny režim:** headless, single-tenant, self-hosted

---

## 1. Prehľad projektu

**Qwen Proxy** je lokálna alebo self-hosted HTTP reverse proxy, ktorá klientom poskytuje stabilné, OpenAI-kompatibilné API nad jedným alebo viacerými DashScope API kľúčmi. Proxy oddeľuje klientov od upstream poverení, routuje logické názvy modelov na konkrétne DashScope modely a transparentne zvláda dočasné zlyhania, rate limit a fallbacky.

Inšpirácia: [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) — multi-account AI proxy s dashboardom, model routerom a smart schedulingom.

### Ciele MVP

- Správa a bezpečné uloženie viacerých DashScope API kľúčov (vrátane štandardných a Coding Plan kľúčov).
- OpenAI-compatible API: chat completions, embeddings, zoznam modelov, health check.
- Konfigurovateľné **modelové skupiny**, aliasy, stratégie výberu kľúča a fallback chain.
- Streaming odpovedí cez SSE bez bufferovania celej odpovede v proxy.
- Lokálna observabilita: request log, latencia, chybovosť a stav jednotlivých kľúčov.
- Headless Docker nasadenie; voliteľné administračné Web UI.

### Rozsah

| Zahrnuté v MVP | Mimo MVP (budúcnosť) |
|---|---|
| Správa API kľúčov (add / edit / delete / import / export) | Multi-user / team features |
| Načítanie modelov a rate-limitov z DashScope | Web UI prístupné cez internet |
| Skupiny modelov s vlastným alias názvom | Platobný modul / cost tracking |
| Lokálny OpenAI-kompatibilný endpoint | Plugin systém / gRPC |
| Model router (group → model), alias lookup | Prometheus / Grafana export |
| Live dashboard (limity, latencia, RPS) | Mobile app |
| Docker deployment | Desktop shell (Tauri) — neskôr |
| Multi-region podpora (Beijing / Singapore / Virginia) | Enterprise multi-workspace routing |
| Fallback chain, circuit breaker | — |

### Ne-ciele

- Proxy nesmie obchádzať podmienky DashScope ani vytvárať ilúziu neobmedzenej kvóty.
- Proxy nie je general-purpose anonymizačná brána — štandardne sa viaže len na loopback.
- Alias znamená routing, nie garantovanú rovnakosť schopností, kvality ani formátu odpovede.

---

## 2. Terminológia

| Pojem | Význam |
|---|---|
| **API key** | Poverenie pre DashScope, uložené šifrovane, nikdy nevydávané klientovi |
| **Proxy key** | Poverenie klienta voči Qwen Proxy |
| **Upstream model** | Konkrétny identifikátor modelu od DashScope |
| **Model group** | Logický model vystavený klientovi; obsahuje kandidátne upstream modely a kľúče |
| **Alias** | Alternatívny klientsky názov modelu mapovaný na modelovú skupinu |
| **Eligible key** | Aktívny kľúč schopný obslúžiť request (podľa capability, cooldownu a limitov) |
| **Quota telemetry** | Informácie o limitoch/usage z upstream zdroja; môžu byť neúplné alebo nedostupné |
| **Circuit breaker** | Dočasné vyradenie kľúča po opakovaných zlyhaniach |
| **key_type** | `standard` (`sk-…`) alebo `coding_plan` (`sk-sp-…`) — určuje base URL a kvótovú logiku |

---

## 3. Overené predpoklady a DashScope kompatibilita

DashScope API sa môže líšiť podľa regiónu, účtu a dátumu. Implementácia **nesmie** predpokladať, že endpoint na modely, usage alebo kvóty je dostupný pre každý kľúč.

### 3.1 Typy kľúčov a regióny

DashScope nemá jeden univerzálny endpoint ani jeden formát kľúča:

| Typ | Prefix | Base URL | Kvótová logika |
|---|---|---|---|
| Štandardný | `sk-…` | `dashscope.aliyuncs.com` (Beijing), `dashscope-intl.aliyuncs.com` (Singapore), `dashscope-us.aliyuncs.com` (Virginia) | Per-token billing, RPM/TPM podľa modelu |
| Coding Plan | `sk-sp-…` | `coding.dashscope.aliyuncs.com/v1` | Rolling request quota: 6 000 req / 5 h, 45 000 / týždeň, 90 000 / mesiac |
| Workspace-scoped | `sk-ws-H.<ws_id>.<suffix>.<cert>` | `https://ws-<workspace_id>.<region>.maas.aliyuncs.com/compatible-mode/v1` | Per-workspace quota; `workspace_id` a `region` dekódované z CSV alebo `apiHost` poľa |

> **Dôsledok:** `ApiKey` musí niesť `region` a `key_type`, pretože routing logika (najmä quota guard a base URL) sa líšia. Bezplatná kvóta pre nové modely platí **iba pre Singapore región** — odporúčaný default pre onboarding.

### 3.2 Upstream Adapter

Core komunikuje výlučne cez rozhranie `UpstreamProviderAdapter`, ktoré izoluje DashScope špecifiká od zvyšku systému:

```ts
interface UpstreamProviderAdapter {
  listModels(key: DecryptedKey): Promise<UpstreamModel[]>;
  chatCompletions(request: NormalizedChatRequest, key: DecryptedKey): Promise<UpstreamResponse>;
  embeddings(request: NormalizedEmbeddingRequest, key: DecryptedKey): Promise<UpstreamResponse>;
  classifyError(error: unknown): UpstreamError;
  readRateLimitHints(response: Headers): RateLimitHints | null;
}
```

Táto hranica umožní testovací fake adapter a neskôr iného kompatibilného providera bez zásahu do routera.

### 3.3 Pravidlá pre kvótové údaje

- Kvótový stav `unknown` nesmie byť prezentovaný ako percentuálny zostatok.
- Proxy automaticky neoznačí kľúč ako `quota_exhausted` bez dôkazu z upstream odpovede.
- `/v1/models` zobrazuje iba skupiny nakonfigurované administrátorom — nie úplný DashScope katalóg.

---

## 4. Architektúra

```
┌─────────────────────────────────────────────────────────────┐
│                     Klientske aplikácie                     │
│   (Claude Code, Cursor, Python SDK, curl, …)                │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/SSE  OpenAI-compatible API
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                      Qwen Proxy Core                        │
│                                                             │
│  HTTP Gateway → Client Auth → Request Validator             │
│       → Resolver (alias/group) → Capability Guard           │
│       → Planner → Key Dispatcher → Quota/Rate Guard         │
│       → DashScope Adapter                                   │
│       ← SSE/Response Normalizer ← Retry & Circuit Breaker   │
│                                                             │
│  SQLite state · encrypted secret store · logs · metrics     │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Alibaba Cloud DashScope (multi-region)            │
│  Beijing:    dashscope.aliyuncs.com/compatible-mode/v1      │
│  Singapore:  dashscope-intl.aliyuncs.com/compatible-mode/v1 │
│  Virginia:   dashscope-us.aliyuncs.com/compatible-mode/v1   │
│  Coding Plan: coding.dashscope.aliyuncs.com/v1              │
└─────────────────────────────────────────────────────────────┘
```

### Komponenty

| Komponent | Zodpovednosť |
|---|---|
| **HTTP Gateway** | Endpointy, request ID, CORS, limity veľkosti requestu, SSE transport |
| **Client Auth** | Overenie proxy key |
| **Request Validator** | Validácia OpenAI payloadu a podporovaných parametrov |
| **Resolver** | `model` → alias alebo group; jednoznačná validácia konfigurácie |
| **Capability Guard** | Zabráni routovaniu vision/tools/embeddings na nekompatibilný upstream model |
| **Planner** | Zostaví usporiadaný plán group → model → eligible key vrátane fallbackov |
| **Dispatcher** | Vyberie kľúč podľa stratégie |
| **Quota/Rate Guard** | Lokálne rate-limit token buckets, response headers, cooldowny |
| **Retry Controller** | Retry iba pre klasifikované, bezpečné chyby pred začatím streamu |
| **DashScope Adapter** | Preklad požiadavky/odpovede a klasifikácia upstream chýb |
| **Secret Store** | Šifrovanie a dešifrovanie upstream kľúčov (AES-256-GCM) |
| **Sync Worker** | Best-effort synchronizácia modelov a quota telemetry |
| **Admin API / Web UI** | Konfigurácia, stav a logy; voliteľná vrstva |

### Invarianty

- DashScope secret sa nikdy nevracia cez API, log, export ani UI.
- Jeden request používa práve jeden upstream kľúč; po začatí SSE streamu sa kľúč nemení.
- Router nikdy nevyberie `disabled`, `invalid` ani `cooldown` kľúč.
- Každý logovaný request má `request_id`; payload sa neukladá v predvolenom nastavení.
- Konfiguračná zmena je transakčná: buď sa uloží celá validná konfigurácia, alebo nič.

---

## 5. Funkcionality

### 5.1 Správa API kľúčov

| ID | Požiadavka |
|---|---|
| F-KEY-01 | Pridať kľúč (manuálne alebo auto-detekcia typu podľa prefixu `sk-` / `sk-sp-`) |
| F-KEY-02 | Pomenovať kľúč aliasom |
| F-KEY-03 | Priradiť kľúč k jednej alebo viacerým skupinám modelov |
| F-KEY-04 | Vybrať / auto-detegovať región kľúča (Beijing / Singapore / Virginia) |
| F-KEY-05 | Zobraziť stav kľúča: `active` / `quota_exhausted` / `invalid` / `rate_limited` / `disabled` / `unknown` |
| F-KEY-06 | Deaktivovať kľúč bez zmazania histórie |
| F-KEY-07 | Batch import cez JSON alebo newline-separated text (v jednej transakcii, deduplikácia fingerprintom) |
| F-KEY-08 | Export kľúčov (šifrovaný, pre zálohu) |
| F-KEY-09 | Test pripojenia — UI ukáže výsledok, čas a upstream HTTP status |

### 5.2 Načítanie modelov a limitov

**F-MDL-01** Po pridaní kľúča automaticky zavolať DashScope endpoint:

```
GET {base_url}/models
Authorization: Bearer {api_key}
```

**F-MDL-02** Pre štandardné kľúče stiahnuť rate-limity cez Model Studio Rate Limits API:

```
GET https://dashscope.aliyuncs.com/api/v1/models/limits?model={model_id}
Authorization: Bearer {api_key}
```

Pre Coding Plan kľúče parsovať rolling-window kvótu z response headers (presný tvar treba overiť — pozri Otvorené rozhodnutia, bod 1).

**F-MDL-03** Periodický refresh limitov (default: 300 s s jitterom ±10 %).
**F-MDL-04** Manuálny refresh tlačidlom v UI.
**F-MDL-05** UI uvádza zdroj telemetrie: `upstream_usage_api`, `response_headers`, `local_estimate` alebo `unknown`.
**F-MDL-06** Upozornenie (badge / toast) keď zostatok klesne pod konfigurovateľný prah (default: 20 %).
**F-MDL-07** Parsovať a logovať DashScope chybové kódy pri 429 odpovedi:

| Chybová správa | Akcia |
|---|---|
| `Rate limit reached for requests` | Krátky backoff, retry s tým istým kľúčom |
| `You exceeded your current quota…` | Označiť kľúč `quota_exhausted`, rotovať na ďalší kľúč |

### 5.3 Skupiny modelov

| ID | Požiadavka |
|---|---|
| F-GRP-01 | CRUD skupiny; ID skupiny je unikátne, spĺňa `[a-zA-Z0-9._-]{1,128}` |
| F-GRP-02 | Kandidátne upstream modely v explicitnom poradí priority |
| F-GRP-03 | Alias modelu — globálne unikátny, nesmie kolidovať s iným group ID |
| F-GRP-04 | Stratégia dispatchera: `round_robin` / `weighted` / `least_recently_used` / `first_available` |
| F-GRP-05 | Fallback chain — cyklus medzi skupinami odmietnutý pri uložení |
| F-GRP-06 | Capability policy — nepodporovaný request vráti 400 namiesto chybného upstream volania |
| F-GRP-07 | Disabled group — vráti 503 bez kontaktovania upstreamu |
| F-GRP-08 | Obmedziť skupinu na konkrétny `key_type` (v MVP neumožniť mix `standard` + `coding_plan` v jednej skupine) |

> `least-quota` nie je garantovaná stratégia MVP. Funguje len ak existuje spoľahlivá telemetria; inak sa bezpečne degraduje na `least_recently_used` a UI to zobrazuje.

**Predefinované skupiny (spravované cez `npm run proxy:seed`):**

| Skupina | Kandidátne upstream modely (v poradí priority) | Alias príklady |
|---|---|---|
| `qwen3.7-max` | qwen3.7-max-2026-06-08, qwen3.7-max-preview, qwen3.7-max-2026-05-20, qwen3.7-max-2026-05-17, qwen3.7-max | gpt-4o, claude-opus-4 |
| `qwen3.7-plus` | qwen3.7-plus-2026-05-26, qwen3.7-plus | gpt-4o-mini |
| `qwen3.7-flash` | qwen3.7-flash-2026-07-15, qwen3.7-flash | gpt-3.5-turbo |
| `qwen-max` | qwen-max, qwen-max-longcontext | claude-sonnet-4 |
| `qwen-plus` | qwen-plus-latest, qwen-plus | — |
| `qwen-turbo` | qwen-turbo-latest, qwen-turbo | — |
| `qwen-coder` | qwen3-coder-plus, qwen3-coder-flash | gpt-4-turbo |
| `qwen-vl` | qwen-vl-max, qwen-vl-plus | gpt-4-vision-preview |
| `embedding` | text-embedding-v4, text-embedding-v3 | text-embedding-ada-002 |

**Konvencia verziovania modelov:**

DashScope pravidelne vydáva datované snapshoty modelov (napr. `qwen3.7-max-2026-06-08`) popri základnom rolujúcom aliase (`qwen3.7-max`). Proxy rieši verziovania takto:

- **Group ID = kanonický klientský názov** (napr. `qwen3.7-plus`) — toto je to, čo klient pošle v poli `model`
- **Candidates = datované varianty v zostupnom poradí dátumu** — newestá verzia má prioritu 1
- **Rolling alias** (bez dátumu) je posledný kandidát — fallback ak datované snapshoty nie sú dostupné
- Pridanie novej verzie = aktualizácia kandidátov skupiny (nie zmena group ID ani client-facing názvu)

```
Klient: model="qwen3.7-plus"
  → Proxy resolvuje skupinu "qwen3.7-plus"
  → Candidate 1: qwen3.7-plus-2026-05-26  ← vždy sa skúsi prvý
  → Candidate 2: qwen3.7-plus              ← fallback
```

### 5.4 Proxy API endpointy

| Endpoint | MVP | Poznámka |
|---|:---:|---|
| `POST /v1/chat/completions` | áno | Non-stream aj SSE streaming |
| `POST /v1/embeddings` | áno | Iba pre group s embedding capability |
| `GET /v1/models` | áno | Exponuje enabled group IDs a aliasy |
| `GET /health` | áno | Liveness |
| `GET /ready` | áno | Readiness; 503 ak nie je použiteľná skupina |
| `GET /metrics` | áno | JSON; nie Prometheus formát |
| `POST /v1/completions` | nie | Odložené |
| Assistants, files, Responses API | nie | Mimo MVP |

- **F-SRV-01** Lokálny HTTP server na konfigurovateľnom porte (default: `8080`).
- **F-SRV-02** Podpora `stream: true` cez SSE — žiadne plné bufferovanie v proxy.
- **F-SRV-03** Proxy API kľúč — klienti sa autentifikujú voči proxy, nie DashScope kľúčom.
- **F-SRV-04** Konfigurovateľný `Access-Control-Allow-Origin`.
- **F-SRV-05** Request / response logging s voliteľným payload logom (default: vypnuté).

### 5.5 Request routing

**Pipeline:**

```
[Request]
   ↓
[Auth check: proxy API key]
   ↓
[Request validation + capability check]
   ↓
[Resolver: alias? → group?]  →  neznámy model: 404 alebo default_group
   ↓
[Planner: usporiadaný zoznam group → upstream model → eligible key]
   ↓
[Dispatcher: vyberie kľúč podľa stratégie + region/key_type filter]
   ↓
[Quota/Rate guard: lokálny bucket]
   ↓ OK                          ↓ rate/quota problém
[Forward to DashScope]        [Cooldown kľúča → ďalší kandidát / 503]
   ↓
[Response normalize → OpenAI formát]
   ↓
[Update quota cache]
   ↓
[Return to client]
```

**Routing pravidlá:**

- **F-RTE-01** `model: "qwen-max"` → skupina `qwen-max`.
- **F-RTE-02** `model: "gpt-4o"` → alias lookup → skupina `qwen-max`.
- **F-RTE-03** Neznámy model → 404 alebo default skupina (konfigurovateľné).
- **F-RTE-04** Na upstream `429` pred prvým bytom odpovede → cooldown kľúča, retry s ďalším kandidátom; po prvom SSE byte sa stream nereplayuje.
- **F-RTE-05** Retry budget: max `min(3, počet kandidátov - 1)` pokusov, obmedzený celkovým deadlinom requestu.
- **F-RTE-06** Ak zlyhajú všetky kľúče skupiny → skúsi fallback group → ak zlyhajú všetky → `503 no_upstream_available`.
- **F-RTE-07** Multimodálne requesty (vision/audio) smerovať cez `compatible-mode` chat endpoint (`image_url` / `input_audio` v `messages`). Natívny DashScope multimodal endpoint použiť len pri funkciách, ktoré `compatible-mode` nepokrýva (napr. video vstup).

**Nesmie sa retryovať:** validačná 4xx chyba, auth chyba, request po začatí SSE streamu.

### 5.6 Dashboard (Web UI)

- **F-UI-01** Prehľad kľúčov — stav, región, key_type, kvóta (progress bar, zdroj telemetrie).
- **F-UI-02** Prehľad skupín — agregovaná kvóta, počet kľúčov, RPS.
- **F-UI-03** Live request log — posledné N requestov s modelom, latenciou, status kódom.
- **F-UI-04** Grafy (posledných 24 h): počet requestov, priemerná latencia, top modely.
- **F-UI-05** Proxy server ovládanie: Start / Stop, aktuálny port (len pre desktop deployment).
- **F-UI-06** Nastavenia: refresh interval, quota threshold, default group, proxy port, proxy API key, default región.
- **F-UI-07** Dark / Light mode.

---

## 6. Technický stack

### Možnosť A — Tauri v2 + React (desktop)

| Vrstva | Technológia |
|---|---|
| Desktop shell | Tauri v2 (Rust backend) |
| UI framework | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| HTTP proxy server | Rust `axum` (vstavané do Tauri backendu) |
| State management | Zustand |
| Charts | Recharts |
| Perzistencia | SQLite cez `rusqlite` |
| Config | TOML (`~/.qwen-proxy/config.toml`) |

### Možnosť B — Node.js + Electron

| Vrstva | Technológia |
|---|---|
| Desktop shell | Electron 33 |
| HTTP proxy server | Fastify alebo Hono |
| UI | React + Vite |
| Perzistencia | better-sqlite3 |
| Config | TOML / JSON |

### Možnosť C — Headless Docker (odporúčané pre MVP)

Čisto Node.js / Rust HTTP server + voliteľné Web UI na samostatnom porte. Najrýchlejšia implementácia, najlepšia pre CI/CD a self-hosted nasadenie. Desktop shell (Možnosť A) pridať neskôr.

---

## 7. Dátový model

SQLite je autoritatívny store pre konfiguráciu, stav a agregované metriky.

```ts
type KeyStatus =
  "active" | "invalid" | "rate_limited" | "quota_exhausted" | "disabled" | "unknown";

type SelectionStrategy =
  "round_robin" | "weighted" | "least_recently_used" | "first_available";

type TelemetrySource =
  "upstream_usage_api" | "response_headers" | "local_estimate" | "unknown";

interface ApiKey {
  id: string;
  alias: string;
  secret_ciphertext: string;       // AES-256-GCM, nikdy plaintext v DB
  fingerprint: string;             // pre deduplikáciu pri importe
  key_type: "standard" | "coding_plan";
  region: "cn-beijing" | "ap-southeast-1" | "us-east-1";
  base_url: string;                // odvodené z regiónu + key_type
  groups: string[];
  status: KeyStatus;
  enabled: boolean;
  cooldown_until: string | null;
  last_validated_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface ModelGroup {
  id: string;
  display_name: string;
  aliases: string[];
  candidates: Array<{
    upstream_model_id: string;
    priority: number;
    capabilities: ("chat" | "streaming" | "embeddings" | "vision" | "tools")[];
  }>;
  key_ids: string[];
  strategy: SelectionStrategy;
  weights: Record<string, number>;
  fallback_group_ids: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface QuotaSnapshot {
  id: string;
  api_key_id: string;
  upstream_model_id: string | null;
  rpm_limit: number | null;
  rpm_remaining: number | null;
  tpm_limit: number | null;
  tpm_remaining: number | null;
  daily_limit: number | null;
  daily_remaining: number | null;
  source: TelemetrySource;
  observed_at: string;
  expires_at: string | null;
}

interface RequestLog {
  id: string;
  request_id: string;
  timestamp: string;
  client_ip: string | null;
  requested_model: string;
  resolved_group_id: string | null;
  upstream_model_id: string | null;
  api_key_id: string | null;
  status_code: number;
  error_code: string | null;
  latency_ms: number;
  ttft_ms: number | null;          // time to first token, pri SSE
  prompt_tokens: number | null;
  completion_tokens: number | null;
  streaming: boolean;
  retry_count: number;
}

interface ProxyConfig {
  port: number;                    // default: 8080
  host: string;                   // default: "127.0.0.1"
  proxy_api_key_hash: string;     // nikdy plaintext
  request_timeout_seconds: number;        // default: 120
  stream_idle_timeout_seconds: number;    // default: 60
  quota_refresh_interval_seconds: number; // default: 300
  quota_warning_threshold: number;        // default: 0.2
  default_group: string | null;
  default_region: string;                 // default: "ap-southeast-1"
  unknown_model_policy: "reject" | "default_group";
  log_requests: boolean;
  log_payload: boolean;
  max_request_log_count: number;          // default: 1000
}
```

---

## 8. API kontrakty

### Autentifikácia

Všetky `/v1/*` endpointy (okrem `/health`, `/ready`) vyžadujú:

```http
Authorization: Bearer <proxy-api-key>
```

Každá odpoveď obsahuje `X-Request-Id`. Diagnostické údaje sa vracajú cez headers, nie vložením vlastných polí do OpenAI response body:

```http
X-Qwen-Proxy-Group: qwen-coder
X-Qwen-Proxy-Upstream-Model: qwen3-coder-plus
X-Qwen-Proxy-Retry-Count: 1
```

`X-Qwen-Proxy-Upstream-Model` je konfigurovateľne vypnuteľný.

### POST /v1/chat/completions

```json
// Request (od klienta)
{
  "model": "qwen-max",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": false,
  "temperature": 0.7
}

// Response (normalizovaná z DashScope)
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "qwen-max",
  "choices": [...],
  "usage": {...}
}
```

### GET /v1/models

```json
{
  "object": "list",
  "data": [
    { "id": "qwen-max",   "object": "model", "owned_by": "qwen-proxy" },
    { "id": "qwen-plus",  "object": "model", "owned_by": "qwen-proxy" },
    { "id": "qwen-coder", "object": "model", "owned_by": "qwen-proxy" },
    { "id": "gpt-4o",     "object": "model", "owned_by": "qwen-proxy" }
  ]
}
```

### GET /health a /ready

```json
{ "status": "ok", "uptime_seconds": 3600, "proxy_version": "1.0.0" }
```

`/ready` vracia `503` ak nie je žiadna použiteľná skupina/kľúč.

### GET /metrics

```json
{
  "total_requests": 1523,
  "requests_last_hour": 87,
  "avg_latency_ms": 412,
  "groups": {
    "qwen-max": { "requests": 450, "quota_fraction": 0.72, "quota_source": "upstream_usage_api" },
    "qwen-plus": { "requests": 890, "quota_fraction": 0.41, "quota_source": "response_headers" }
  }
}
```

### Chybový formát

```json
{
  "error": {
    "message": "No eligible upstream key is currently available.",
    "type": "server_error",
    "param": null,
    "code": "no_upstream_available"
  }
}
```

| HTTP status | Kód | Význam |
|---:|---|---|
| 400 | `invalid_request` / `unsupported_capability` | Neplatný alebo nepodporovaný payload |
| 401 | `invalid_proxy_key` | Chýbajúce alebo neplatné klientské poverenie |
| 404 | `model_not_found` | Alias ani group neexistujú |
| 429 | `proxy_rate_limited` | Lokálny limit proxy bol prekročený |
| 503 | `group_disabled` / `no_upstream_available` | Skupina nie je dostupná |
| 502 | `upstream_error` | Upstream poskytol chybnú odpoveď |
| 504 | `upstream_timeout` | Vypršal celkový deadline |

### Admin API

```
# API kľúče
GET    /api/keys
POST   /api/keys
PUT    /api/keys/:id
DELETE /api/keys/:id
POST   /api/keys/:id/test
POST   /api/keys/:id/refresh-quota
POST   /api/keys/import
POST   /api/keys/export

# Skupiny
GET    /api/groups
POST   /api/groups
PUT    /api/groups/:id
DELETE /api/groups/:id

# Modely (načítané z upstream)
GET    /api/models

# Proxy server (len pre desktop deployment)
GET    /api/proxy/status
POST   /api/proxy/start
POST   /api/proxy/stop
GET    /api/proxy/config
PUT    /api/proxy/config

# Logy a štatistiky
GET    /api/logs?limit=50&group=qwen-max
GET    /api/stats/summary
GET    /api/stats/timeline?hours=24
```

---

## 9. Konfigurácia

Umiestnenie: `~/.qwen-proxy/config.toml`

Súbor obsahuje **iba necitlivé nastavenia**. Secret kľúče sú v OS keychain alebo šifrovanom secret store, nie v TOML.

```toml
[proxy]
port = 8080
host = "127.0.0.1"
request_timeout_seconds = 120
stream_idle_timeout_seconds = 60
log_requests = true
log_payload = false
log_retention_days = 30

[routing]
default_group = "qwen-plus"
unknown_model_policy = "reject"  # reject | default_group
quota_refresh_interval_seconds = 300
quota_warning_threshold = 0.20
default_region = "ap-southeast-1"

[storage]
database_path = "~/.qwen-proxy/qwen-proxy.db"

[[keys]]
id = "key-1"
alias = "Osobný kľúč"
key_type = "standard"
region = "ap-southeast-1"
# secret uložený šifrovane v keystore
groups = ["qwen-max", "qwen-plus", "qwen-coder"]
enabled = true

[[groups]]
id = "qwen-max"
display_name = "Qwen Max"
aliases = ["gpt-4o", "claude-opus-4"]
upstream_models = ["qwen-max", "qwen-max-longcontext"]
strategy = "least_recently_used"
fallback_group = "qwen-plus"
enabled = true

[[groups]]
id = "qwen-coder"
display_name = "Qwen Coder"
aliases = ["gpt-4-turbo"]
upstream_models = ["qwen3-coder-plus"]
strategy = "round_robin"
enabled = true

[[groups]]
id = "embedding"
display_name = "Embedding"
aliases = ["text-embedding-ada-002"]
upstream_models = ["text-embedding-v3"]
strategy = "first_available"
enabled = true
```

---

## 10. Error handling a observabilita

- **Retry politika:** exponenciálny backoff (base 500 ms, max 3 pokusy) pre `429 rate limit reached`; okamžitá rotácia kľúča pre `429 quota exceeded` a `401/403`.
- **Circuit breaker:** ak kľúč zlyhá N-krát za sebou (default 5), vyradiť ho na cooldown (default 60 s).
- **Timeouty:** request timeout 120 s pre non-stream; idle timeout 60 s medzi SSE chunkami.
- **Štruktúrované logy:** JSON formát s `request_id`, `key_id`, `group`, `latency_ms`, `status_code`, `retry_count`.
- **`/health` vs `/ready`:** `health` = proxy beží; `ready` = aspoň jedna skupina má eligible kľúč.
- **Telemetria source vždy viditeľná v UI** — klient nikdy nevidí `unknown` ako percentuálny zostatok.

---

## 11. Bezpečnosť (minimum pre hobby projekt)

| Riziko | Opatrenie |
|---|---|
| Únik API kľúčov | AES-256-GCM, plaintext iba v pamäti počas requestu |
| Neoprávnený prístup k proxy | Proxy key povinný pre každý request |
| Payload logging | Vypnutý štandardne |
| CORS | Whitelist, default iba localhost |
| Sieťová expozícia | Default `127.0.0.1`; bind na `0.0.0.0` vyžaduje explicitné nastavenie |

---

## 12. Implementačný plán

### Fáza 0 — Discovery spike ✅ DOKONČENÉ (2026-09-03)

**Výsledky** (pozri `docs/upstream-compatibility.md`):
- Potvrdené: `compatible-mode/v1` endpoint pre chat, embeddings, models; SSE streaming s `[DONE]` markerom.
- Skutočný typ kľúča: **workspace-scoped** (`sk-ws-H.*`) s per-workspace hostname `ws-<id>.<region>.maas.aliyuncs.com` — odlišné od pôvodného predpokladu fixných regionálnych URL.
- `X-RateLimit-*` headers **nie sú prítomné** — quota telemetria dostupná len cez error kódy (`insufficient_quota`) alebo lokálnym odhadom.
- Error klasifikácia overená: 401→`invalid`, 403 `insufficient_quota`→`quota_exhausted`, 403 `AccessDenied.Unpurchased`→`disabled`.
- `/models` vracia 165 modelov vrátane `deepseek-v3.2`, `kimi-k3`, atď. — nie len Qwen modely.
- Funkcia calling (tools): 403 kvôli vyčerpaniu kvóty na free tier; API kompatibilita predpokladaná.

**DoD splnené:** `docs/upstream-compatibility.md` + discovery skripty.

### Fáza 1 — Headless proxy jadro 🔄 V PROGRESE

- [x] SQLite schema (`api_keys`, `model_groups`, `quota_snapshots`, `request_logs`) + WAL + migrácie.
- [x] AES-256-GCM secret store (`server/lib/crypto.ts`, `secret-store.ts`).
- [x] Config layer cez env vars (`.env` + `server/lib/config.ts`).
- [x] Admin CRUD API: `/api/keys`, `/api/groups`, `/api/logs`, `/api/stats/*`.
- [x] `/health`, `/ready`, `/v1/models`, `/v1/chat/completions` (non-stream + SSE streaming).
- [x] `/v1/embeddings` endpoint.
- [x] Alias resolver + capability guard (`group-store.ts`).
- [x] `round_robin`, `first_available`, `least_recently_used`, `weighted` stratégie.
- [x] Request IDs + štruktúrované JSON logy.
- [x] DashScope adapter (`compatible-mode/v1` endpoint, workspace-scoped base URL).
- [x] CSV key import skript (`server/scripts/import-keys.ts`).
- [x] Retry logic + exponential backoff + fallback groups.
- [x] Circuit breaker (5 consecutive failures → 60 s cooldown).
- [x] Client auth middleware (proxy API key hash check).
- [x] **Batch import API** (`POST /api/keys/import`) — deduplikácia fingerprintom, transakčné spracovanie.
- [x] **Export API** (`POST /api/keys/export`) — bezpečný export metadát bez plaintext secretov.
- [x] **`POST /api/keys/:id/refresh-quota`** — test pripojenia a aktualizácia stavu kľúča.
- [x] **Streaming TTFT tracking** — `ttft_ms` meraný pri prvom SSE chunku, token usage extrakcia.
- [x] **Timeout enforcement** — `AbortController` s `REQUEST_TIMEOUT_SECONDS` a 504 `upstream_timeout`.
- [x] **Čisté ESM (`import`)** — odstránené všetky `require()` volania.
- [x] **`/metrics` endpoint** — opravený import `getStats`.
- [x] **Automatizované testy (Vitest)** — 22 testov pre crypto/secret-store, group-store, dispatcher a HTTP API.
- [ ] **Web UI integrácia** — Next.js UI (`app/page.tsx`) má mock dáta; treba zapojiť na real Admin API.

**DoD:** Python OpenAI SDK a curl úspešne používajú group/alias; upstream secret sa nenachádza v logoch ani DB plaintext.

### Fáza 2 — Odolnosť a telemetry (2 týždne)

- [ ] Klasifikácia chýb, cooldown / circuit breaker, retry budget, fallback graph.
- [ ] `/v1/embeddings`, token / latency metriky, retention worker.
- [ ] Best-effort model/usage sync; transparentný `TelemetrySource`.

**DoD:** testy pokrývajú 401, 429, 5xx, timeout, vyčerpanie kandidátov, fallback cycle, prerušený SSE stream.

### Fáza 3 — Docker + hardening (1 týždeň)

- [ ] Rate/concurrency limity, encrypted import/export, image hardening (non-root, read-only FS).
- [ ] Docker Compose, health/readiness probes, DB migrácie, backup/restore.

**DoD:** čistá inštalácia cez Compose, reštart bez straty konfigurácie.

### Fáza 4 — Web UI alebo Tauri (po stabilizácii core)

- [ ] Dashboard nad stabilným Admin API: keys, groups, status, logy, grafy.
- [ ] Desktop shell až keď headless core má integračné kontrakty a release proces.

---

## 13. Testovacia stratégia

| Vrstva | Povinné scenáre |
|---|---|
| Unit | Alias kolízie, fallback cykly, strategy selection, capability matching |
| Adapter contract | Normalizácia DashScope payloadu, error mapping, streaming parser, rate-limit headers |
| Integration | Python OpenAI SDK; non-stream, SSE, embeddings, auth, 404/429/503/504 |
| Failure injection | Neplatný kľúč, 429, 5xx, timeout, pomalý stream, client disconnect |
| Load | Konfigurovaná súbežnosť, stabilita SQLite, graceful shutdown |

Povinné: deterministický fake `UpstreamProviderAdapter` pre offline testy.

---

## 14. Príklady použitia

### Claude Code CLI

```bash
export OPENAI_API_KEY="sk-proxy-moj-lokalny-kluc"
export OPENAI_BASE_URL="http://127.0.0.1:8080/v1"
claude --model qwen-coder "Napíš unit test pre túto funkciu"
```

### Python SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-proxy-moj-lokalny-kluc",
    base_url="http://127.0.0.1:8080/v1",
)

response = client.chat.completions.create(
    model="qwen-coder",   # → skupina → qwen3-coder-plus
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### curl so streamingom

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-proxy-moj-lokalny-kluc" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role":"user","content":"Hi"}],
    "stream": true
  }'
```

---

### 15. Otvorené rozhodnutia

1. **Coding Plan quota endpoint** ✅ čiastočne — `X-RateLimit-*` headers neexistujú ani pre štandardné kľúče. Quota tracking cez error kódy a lokálny odhad. Coding Plan kľúče netestované.

2. **Upstream contract** ✅ overené — `compatible-mode/v1` je funkčný pre chat, streaming, embeddings, models. Workspace-scoped kľúče používajú per-workspace hostname, nie fixné regionálne URL.

3. **Secret provider** ✅ rozhodnuté — AES-256-GCM s klíčem z `ENCRYPTION_KEY` env var. Pre Docker: `docker secret` alebo `.env` file mimo repo.

4. **Proxy key model** ✅ rozhodnuté — jeden shared key pre lokálny režim (`PROXY_API_KEY` env var), hash uložený v config. Multi-client identities mimo MVP.

5. **Payload compatibility** 🔄 čiastočne — chat/embeddings/vision fungujú. Tools API: 403 na free tier (predpokladáme kompatibilitu). JSON schema, audio mimo MVP. Presné mapovanie parametrov (`n`, `logprobs`, `presence_penalty`, atď.) nie je explicitne definované — treba rozhodnúť, čo sa passthru vs. odmietne.

6. **Verziovanie model ID** ❌ neriešené — skupiny obsahujú explicitné model ID (napr. `qwen-max`). Alibaba pravidelne mení názvy. Rozhodnúť: auto-refresh z `/models` endpointu, alebo manuálna konfigurácia?

7. **Mix key_type v skupinách** ✅ rozhodnuté — MVP zakazuje kombináciu `standard` + `coding_plan` v jednej skupiny. `workspace_scoped` kľúče fungujú rovnako ako `standard` pre routing účely.

8. **Web UI ↔ backend integrácia** ❌ neriešené — Next.js dashboard (`app/page.tsx`) obsahuje iba mock dáta. Treba rozhodnúť: API URL konfigurácia (hard-coded `localhost:8080` vs. env var `NEXT_PUBLIC_PROXY_API_URL`), autentifikácia z UI na admin API.

9. **Paralelné spustenie** ❌ neriešené — proxy beží na porte 8080, Next.js na 3456. Treba rozhodnúť, ako sa spúšťajú spolu (napr. `concurrently`, Docker Compose, alebo jeden integrovaný server).

---

*Koniec dokumentu — Qwen Proxy, verzia 0.4*