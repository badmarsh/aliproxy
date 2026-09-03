'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  fetchConfig,
  fetchProviders,
  fetchTrialRadar,
  reseedTrials,
  fetchIntakeStatus,
  scanIntakeFolder,
  exportGroups,
  importGroups,
  getAdminKey,
  setAdminKey,
  hasAdminKeyOverride,
  type ProviderPresetItem,
  type IntakeStatus,
} from '@/lib/api-client'

export default function SettingsPage() {
  const [config, setConfig] = useState<any>(null)
  const [providers, setProviders] = useState<ProviderPresetItem[]>([])
  const [radar, setRadar] = useState<any>(null)
  const [intake, setIntake] = useState<IntakeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminKeyInput, setAdminKeyInput] = useState('')
  const [keyOverridden, setKeyOverridden] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)

  async function load() {
    try {
      const [c, p, r, i] = await Promise.allSettled([
        fetchConfig(),
        fetchProviders(),
        fetchTrialRadar(),
        fetchIntakeStatus(),
      ])
      if (c.status === 'fulfilled') setConfig(c.value)
      if (p.status === 'fulfilled') setProviders(p.value)
      if (r.status === 'fulfilled') setRadar(r.value)
      if (i.status === 'fulfilled') setIntake(i.value)
      setError(c.status === 'rejected' ? 'Could not reach the proxy server — is `npm run proxy` running?' : null)
    } catch (err: any) {
      setError(err.message)
    }
  }

  useEffect(() => {
    load()
    setKeyOverridden(hasAdminKeyOverride())
  }, [])

  function saveAdminKey() {
    setAdminKey(adminKeyInput.trim() || null)
    setKeyOverridden(hasAdminKeyOverride())
    setAdminKeyInput('')
    setNotice(adminKeyInput.trim() ? 'Admin key saved — dashboard now uses it for every call.' : 'Admin key override cleared — using build-time default.')
  }

  async function handleExport() {
    setBackupBusy(true)
    setNotice(null)
    try {
      const data = await exportGroups()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aliproxy-groups-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setNotice(`Exported ${data.count} groups.`)
    } catch (err: any) {
      setNotice(`Export failed: ${err.message}`)
    } finally {
      setBackupBusy(false)
    }
  }

  async function handleImportFile(file: File) {
    setBackupBusy(true)
    setNotice(null)
    try {
      const parsed = JSON.parse(await file.text())
      const groups = Array.isArray(parsed) ? parsed : parsed.groups
      if (!Array.isArray(groups)) throw new Error('No groups array found in file')
      const result = await importGroups(groups)
      setNotice(`Imported groups: ${result.created} created, ${result.updated} updated${result.errors.length ? `, ${result.errors.length} errors` : ''}.`)
      await load()
    } catch (err: any) {
      setNotice(`Import failed: ${err.message}`)
    } finally {
      setBackupBusy(false)
    }
  }

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

  async function handleScan() {
    setBusy(true)
    setNotice(null)
    try {
      const report = await scanIntakeFolder()
      setNotice(
        report.files_handled === 0
          ? 'Intake folder is empty — nothing to import.'
          : `Imported ${report.keys_imported} keys from ${report.files_handled} file(s).`,
      )
      await load()
    } catch (err: any) {
      setNotice(`Scan failed: ${err.message}`)
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

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>
              Dashboard API key — stored in this browser only (localStorage). Override when your server uses a
              different master key than the build-time default.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={adminKeyInput}
                onChange={(e) => setAdminKeyInput(e.target.value)}
                placeholder={keyOverridden ? 'override active — enter to replace' : 'default key in use'}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Button size="sm" onClick={saveAdminKey}>
                Save key
              </Button>
              {keyOverridden && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAdminKey(null)
                    setKeyOverridden(false)
                    setNotice('Admin key override cleared.')
                  }}
                >
                  Clear override
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {keyOverridden
                ? '✓ Using a custom admin key from this browser.'
                : 'Using the build-time default key. Set PROXY_API_KEY on the server and enter it here for real deployments.'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Backup &amp; restore groups</CardTitle>
            <CardDescription>Model groups live in SQLite — export a JSON snapshot or restore one</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={backupBusy}>
              ⬇ Export groups JSON
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent">
              ⬆ Import snapshot
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleImportFile(f)
                  e.target.value = ''
                }}
              />
            </label>
            <span className="text-xs text-muted-foreground">import upserts by group id — safe to re-run</span>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Trial key intake</CardTitle>
            <CardDescription>
              Alibaba has no OAuth for issuing keys — the console is the only source. Drop files into the
              intake folder and everything else (encrypt → import → seed trials) happens automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border p-2.5">
                <div className="text-xs text-muted-foreground">Folder</div>
                <code className="text-xs font-semibold">{intake?.dir ?? '—'}</code>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-xs text-muted-foreground">Watching</div>
                <Badge variant={intake?.watching ? 'default' : 'secondary'} className="text-xs">
                  {intake?.watching ? 'live' : 'idle'}
                </Badge>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-xs text-muted-foreground">Auto-attach groups</div>
                <code className="text-xs">{intake?.auto_groups?.length ? intake.auto_groups.join(', ') : 'none'}</code>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Accepted: raw <code className="rounded bg-muted px-1">sk-…</code> lines (.txt), DashScope console CSV
              exports, JSON (<code className="rounded bg-muted px-1">{`{keys:[…]}`}</code>). Processed files move to{' '}
              <code className="rounded bg-muted px-1">processed/</code>; configure via <code className="rounded bg-muted px-1">INTAKE_DIR</code>,{' '}
              <code className="rounded bg-muted px-1">INTAKE_AUTO_GROUPS</code>.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleScan} disabled={busy}>
                Scan intake folder now
              </Button>
              <a
                href="https://bailian.console.alibabacloud.com/?tab=model#/api-key"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium underline underline-offset-2"
              >
                Get a trial key (Model Studio intl) ↗
              </a>
              <a
                href="https://bailian.console.aliyun.com/?tab=model#/api-key"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium underline underline-offset-2"
              >
                China console ↗
              </a>
            </div>
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
