'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchConfig, fetchProviders, fetchTrialRadar, reseedTrials, type ProviderPresetItem } from '@/lib/api-client'

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null)
  const [providers, setProviders] = useState<ProviderPresetItem[]>([])
  const [radar, setRadar] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const [c, p, r] = await Promise.allSettled([fetchConfig(), fetchProviders(), fetchTrialRadar()])
      if (c.status === 'fulfilled') setConfig(c.value)
      if (p.status === 'fulfilled') setProviders(p.value)
      if (r.status === 'fulfilled') setRadar(r.value)
      setError(c.status === 'rejected' ? 'Could not reach the proxy server — is `npm run proxy` running?' : null)
    } catch (err: any) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleReseed() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await reseedTrials()
      setNotice(`Seeded ${result.rows_seeded} trial rows across ${result.keys_touched} keys.`)
      await load()
    } catch (err: any) {
      setNotice(`Reseed failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell title="Settings" right={<Button variant="outline" size="sm" onClick={load}>Refresh</Button>}>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Runtime configuration — loaded from environment variables (`.env`)</p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Proxy server</CardTitle>
            <CardDescription>Change via environment variables, then restart</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              ['Listen endpoint', `${config?.proxy?.host ?? '127.0.0.1'}:${config?.proxy?.port ?? 8080}`],
              ['Request timeout', `${config?.proxy?.request_timeout_seconds ?? 120}s`],
              ['Stream idle timeout', `${config?.proxy?.stream_idle_timeout_seconds ?? 60}s`],
              ['Default region', config?.routing?.defaultRegion ?? 'ap-southeast-1'],
              ['Unknown model policy', config?.routing?.unknownModelPolicy ?? 'reject'],
              ['Max request log', config?.logging?.maxRequestLogCount ?? 1000],
              ['Trial rows tracked', radar?.totals?.models_tracked ?? 0],
            ].map(([k, v]) => (
              <div key={String(k)} className="grid grid-cols-2 border-b pb-2 last:border-0">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-mono text-xs">{v}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connect any OpenAI-compatible client</CardTitle>
            <CardDescription>Chat, images, video, embeddings — one endpoint</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px]">
{`# chat
curl http://127.0.0.1:8080/v1/chat/completions \\
  -H "Authorization: Bearer $ALIPROXY_KEY" \\
  -d '{"model":"aliproxy-demo","messages":[{"role":"user","content":"hi"}]}'

# image (free wanx trials)
curl http://127.0.0.1:8080/v1/images/generations \\
  -H "Authorization: Bearer $ALIPROXY_KEY" \\
  -d '{"model":"wanx2.1-t2i-turbo","prompt":"a cat astronaut"}'

# video (async: submit → poll)
curl -X POST http://127.0.0.1:8080/v1/videos/generations \\
  -H "Authorization: Bearer $ALIPROXY_KEY" \\
  -d '{"model":"wan2.1-t2v-turbo","input":{"prompt":"a cat astronaut"}}'
# → then GET /v1/videos/generations/{task_id}`}
            </pre>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Upstream providers</CardTitle>
            <CardDescription>
              Presets used by “Add Key” — each seeds its free-trial quotas into the Quota Radar automatically
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {providers.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border p-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {p.label}
                      {p.built_in && <Badge variant="outline" className="text-[10px]">built-in</Badge>}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{p.base_url}</div>
                  </div>
                  <Badge variant="secondary" className="ml-2 shrink-0 text-[10px]">{p.region}</Badge>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={handleReseed} disabled={busy}>
                {busy ? 'Seeding…' : 'Reseed trial quotas from presets'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
