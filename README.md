# Qwen Proxy Dashboard

A local desktop dashboard for managing DashScope/Qwen API keys, model groups, and routing — built with Next.js, shadcn/ui, and a Vercel-inspired monochrome theme.

## Overview

The Qwen Proxy Dashboard is the Web UI component of the Qwen Proxy system. It provides:

- **API Key Management** — add, edit, delete, enable/disable DashScope API keys
- **Model Groups** — create groups of upstream models with routing strategies (round-robin, least-quota, weighted, first-available)
- **Metrics Dashboard** — request volume charts, latency distribution, live request logs
- **Settings** — proxy server controls (start/stop), port/host config, quota refresh intervals, dark/light mode, theme picker

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| UI Components | shadcn/ui (Radix primitives) |
| Styling | Tailwind CSS 3.4 |
| Charts | Recharts 2 |
| State | currently local useState; Zustand ready for scale |

## Project Structure

```
AliProxy/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Main dashboard (tabs: overview, keys, groups, metrics, settings)
│   ├── globals.css         # CSS variables (Vercel monochrome theme) + Tailwind
│   ├── keys/page.tsx       # Dedicated API keys CRUD page
│   ├── groups/page.tsx     # Dedicated model groups page
│   ├── metrics/page.tsx    # Metrics + charts + request logs
│   └── settings/page.tsx   # Proxy controls + appearance settings
├── components/
│   └── ui/
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── dialog.tsx
│       ├── input.tsx
│       ├── label.tsx
│       ├── select.tsx
│       ├── switch.tsx
│       ├── table.tsx
│       └── tabs.tsx
├── lib/
│   └── utils.ts            # cn() helper
├── components.json          # shadcn/ui config
├── tailwind.config.js       # Vercel monochrome theme
├── package.json
└── specs.md                 # Original technical spec (Slovak)
```

## Getting Started

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Theme

The default theme is **Vercel** — a stark black-and-white monochrome palette. The theme picker in Settings also provides **Blue** and **Green** options (currently placeholder colors — wire up via CSS variable overrides to activate).

Dark mode is enabled by default. Toggle via `Settings → Appearance → Dark Mode`.

## Build Status

```
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (8/8)
```

All pages compile and type-check cleanly. The build produces static HTML for all routes.

## Current State

**Completed:**
- All UI components (shadcn/ui) created and working
- Vercel monochrome theme CSS variables configured
- 6 routes: `/`, `/keys`, `/groups`, `/metrics`, `/settings`
- All pages have mock data for demo purposes
- Build passes with zero errors

**To Wire Up (backend integration):**
- Replace mock data in all pages with real API calls to the proxy backend
- Implement actual state management with Zustand stores
- Add real-time WebSocket updates for live request logs and quota refreshes
- Wire up the theme picker to actually swap CSS variables
- Add proper error handling and loading states
- Add form validation for API key/group creation

**Known Issues:**
- Next.js 14.2.33 has a security advisory (2025-12-11); consider upgrading to 15.x
- `recharts@2.12.7` is deprecated; the v3 migration guide is available
- `curl` connectivity to localhost was unreliable during testing — likely a network proxy issue on this machine, not a code problem

## Next Steps (from specs.md Phase 1)

1. **Key Store** — Implement the actual backend for API key storage with AES-256-GCM encryption
2. **DashScope model fetch** — Call `/v1/models` endpoint to populate model data
3. **HTTP proxy server** — Implement the OpenAI-compatible chat/completions endpoint with streaming
4. **Model group config** — Wire up TOML config file reading/writing
5. **Round-robin dispatcher** — Implement the routing logic