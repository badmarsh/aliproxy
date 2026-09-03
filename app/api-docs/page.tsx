'use client'

import { useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { getAdminKey } from '@/lib/api-client'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface Endpoint {
  method: Method
  path: string
  desc: string
  note?: string
}

const SECTIONS: Array<{ title: string; description: string; auth: string; endpoints: Endpoint[] }> = [
  {
    title: 'Proxy API — OpenAI-compatible',
    description: 'What your applications call. Bearer = master key or sk-aliproxy-* client key.',
    auth: 'Bearer master/client key',
    endpoints: [
      { method: 'POST', path: '/v1/chat/completions', desc: 'Chat (sync + streaming), vision & tools auto-detected' },
      { method: 'POST', path: '/v1/embeddings', desc: 'Text embeddings' },
      { method: 'POST', path: '/v1/images/generations', desc: 'Image generation (OpenAI shape → DashScope text2image)', note: 'call-based trial metering' },
      { method: 'POST', path: '/v1/videos/generations', desc: 'Video generation — async submit, returns task_id', note: 'call-based trial metering' },
      { method: 'GET', path: '/v1/videos/generations/:task_id', desc: 'Poll a video task until SUCCEEDED' },
      { method: 'GET', path: '/v1/models', desc: 'Groups + aliases as a model list' },
      { method: 'GET', path: '/health · /ready · /metrics', desc: 'Health, readiness, stats — no auth' },
    ],
  },
  {
    title: 'Keys & farm',
    description: 'Upstream key management, sweep, and the intake folder.',
    auth: 'Bearer admin key',
    endpoints: [
      { method: 'GET', path: '/api/keys', desc: 'List upstream keys (fingerprints only, never plaintext)' },
      { method: 'POST', path: '/api/keys', desc: 'Add a key — trials auto-seeded from provider presets' },
      { method: 'PUT', path: '/api/keys/:id', desc: 'Update alias / enabled / status' },
      { method: 'DELETE', path: '/api/keys/:id', desc: 'Delete a key' },
      { method: 'POST', path: '/api/keys/:id/test', desc: 'Validate against upstream /models' },
      { method: 'POST', path: '/api/keys/import', desc: 'Bulk import: array / {keys:[…]} / {text:"sk-…"}' },
      { method: 'POST', path: '/api/keys/upload-csv', desc: 'Upload DashScope console CSV export files' },
      { method: 'POST', path: '/api/keys/sweep', desc: 'Validate all keys + reseed trial rows' },
      { method: 'GET', path: '/api/keys/intake/status', desc: 'Intake folder status + last report' },
      { method: 'POST', path: '/api/keys/intake/scan', desc: 'Scan the intake folder now' },
      { method: 'GET', path: '/api/providers', desc: 'Provider presets (base URLs, regions)' },
    ],
  },
  {
    title: 'Groups',
    description: 'Client-facing model names → upstream candidates.',
    auth: 'Bearer admin key',
    endpoints: [
      { method: 'GET', path: '/api/groups', desc: 'List groups' },
      { method: 'POST', path: '/api/groups', desc: 'Create group (candidates in priority order)' },
      { method: 'PUT', path: '/api/groups/:id', desc: 'Update candidates / strategy / aliases / enabled' },
      { method: 'DELETE', path: '/api/groups/:id', desc: 'Delete group' },
      { method: 'GET', path: '/api/groups/export', desc: 'Snapshot all groups as JSON' },
      { method: 'POST', path: '/api/groups/import', desc: 'Upsert groups from a snapshot (array or {groups:[…]})' },
    ],
  },
  {
    title: 'Trials · Quota Radar',
    description: 'The free-quota ledger.',
    auth: 'Bearer admin key',
    endpoints: [
      { method: 'GET', path: '/api/trials/radar', desc: 'Model × key matrix + farm totals' },
      { method: 'GET', path: '/api/trials/expiring?days=7', desc: 'Trials with quota left, expiring soon' },
      { method: 'GET', path: '/api/trials/presets', desc: 'Current provider trial presets' },
      { method: 'POST', path: '/api/trials/reseed[?key_id=…]', desc: 'Seed missing trial rows' },
      { method: 'PUT', path: '/api/trials/:keyId/:model', desc: 'Correct a quota: {kind, limit_amount, expires_at}' },
      { method: 'DELETE', path: '/api/trials/:keyId/:model', desc: 'Remove a trial row' },
    ],
  },
  {
    title: 'Client keys · usage',
    description: 'Virtual keys and analytics.',
    auth: 'Bearer admin key',
    endpoints: [
      { method: 'GET', path: '/api/client-keys', desc: 'List virtual keys' },
      { method: 'POST', path: '/api/client-keys', desc: 'Issue key: {name, rpm_limit, daily_*, allowed_group_ids} — plaintext shown once' },
      { method: 'PUT', path: '/api/client-keys/:id', desc: 'Update limits / enable / allowlist' },
      { method: 'POST', path: '/api/client-keys/:id/rotate', desc: 'New token, old dies instantly' },
      { method: 'DELETE', path: '/api/client-keys/:id', desc: 'Revoke' },
      { method: 'GET', path: '/api/usage/summary?days=30', desc: 'Totals + by model/group/consumer' },
      { method: 'GET', path: '/api/usage/daily?days=30', desc: 'Daily series' },
      { method: 'GET', path: '/api/usage/savings', desc: 'Spend-avoided meter (the scoreboard)' },
    ],
  },
  {
    title: 'Dashboard passthroughs',
    description: 'Same-origin, admin-authed — used by Studio & Playground.',
    auth: 'Bearer admin key',
    endpoints: [
      { method: 'POST', path: '/api/proxy/chat/completions', desc: 'Playground chat (stream or sync)' },
      { method: 'POST', path: '/api/proxy/images/generations', desc: 'Studio image generation' },
      { method: 'POST', path: '/api/proxy/videos/generations', desc: 'Studio video submit' },
      { method: 'GET', path: '/api/proxy/videos/generations/:taskId', desc: 'Studio video poll' },
      { method: 'GET', path: '/api/logs?limit&group&model&status&mode', desc: 'Request log with filters (p50/p95 in stats)' },
      { method: 'GET', path: '/api/stats/summary · /api/stats/timeline', desc: 'Traffic stats + hourly series' },
    ],
  },
]

const METHOD_STYLES: Record<Method, string> = {
  GET: 'bg-emerald-100 text-emerald-800',
  POST: 'bg-sky-100 text-sky-800',
  PUT: 'bg-amber-100 text-amber-800',
  DELETE: 'bg-rose-100 text-rose-800',
}

export default function ApiDocsPage() {
  const [curl, setCurl] = useState('')

  function copyCurl(ep: Endpoint) {
    const base = 'http://127.0.0.1:8080'
    const key = getAdminKey()
    let cmd = `curl ${base}${ep.path.split(' ')[0]} -H "Authorization: Bearer ${key}"`
    if (ep.method !== 'GET') {
      cmd = `curl -X ${ep.method} ${base}${ep.path} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{…}'`
    }
    navigator.clipboard?.writeText(cmd)
    setCurl(cmd)
    setTimeout(() => setCurl(''), 4000)
  }

  return (
    <AppShell title="API Docs">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">API Reference</h2>
        <p className="text-sm text-muted-foreground">
          Every endpoint on the proxy server. Click any row to copy a ready-to-run curl with your current admin key.
        </p>
      </div>

      {curl && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p className="mb-1 text-xs font-medium text-emerald-800">Copied to clipboard:</p>
          <pre className="overflow-x-auto font-mono text-[11px] text-emerald-900">{curl}</pre>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{section.title}</CardTitle>
              <CardDescription>
                {section.description} · <span className="font-mono">{section.auth}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {section.endpoints.map((ep) => (
                <button
                  key={`${ep.method} ${ep.path}`}
                  onClick={() => copyCurl(ep)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
                >
                  <Badge className={`mt-0.5 shrink-0 font-mono text-[10px] ${METHOD_STYLES[ep.method]}`}>{ep.method}</Badge>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs font-semibold">{ep.path}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ep.desc}
                      {ep.note && <span className="ml-1 text-[10px] text-emerald-700">· {ep.note}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  )
}
