'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  fetchTrialRadar,
  fetchExpiringTrials,
  reseedTrials,
  type TrialRadar,
  type ExpiringTrial,
} from '@/lib/api-client'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function QuotaRadarPage() {
  const [radar, setRadar] = useState<TrialRadar | null>(null)
  const [expiring, setExpiring] = useState<ExpiringTrial[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, e] = await Promise.all([fetchTrialRadar(), fetchExpiringTrials(7)])
      setRadar(r)
      setExpiring(e)
    } catch (err: any) {
      setError(err.message || 'Failed to load trial radar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [load])

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

  const totals = radar?.totals

  return (
    <AppShell title="Quota Radar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Quota Radar</h2>
          <p className="text-sm text-muted-foreground">
            Every free-trial quota across every key — burn the expiring ones first.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? 'Scanning…' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={handleReseed} disabled={busy}>
            {busy ? 'Seeding…' : 'Reseed trials'}
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error} — is the proxy server running? (<code>npm run proxy</code>)
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Free tokens remaining</CardDescription>
            <CardTitle className="text-3xl text-emerald-600">
              {totals ? fmtTokens(totals.free_tokens_remaining) : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">across {totals?.keys_tracked ?? 0} keys</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Free image/video calls</CardDescription>
            <CardTitle className="text-3xl text-emerald-600">
              {totals ? totals.free_calls_remaining.toLocaleString() : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">wanx / wan trials remaining</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Models tracked</CardDescription>
            <CardTitle className="text-3xl">{totals?.models_tracked ?? '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">{totals?.exhausted_rows ?? 0} exhausted rows</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Expiring ≤ 7 days</CardDescription>
            <CardTitle className="text-3xl text-amber-600">{expiring.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">use it or lose it</div>
          </CardContent>
        </Card>
      </div>

      {expiring.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">⏰ Burning soon</CardTitle>
            <CardDescription>Trials with quota left that expire within a week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {expiring.map((t, i) => (
                <Badge key={i} variant="outline" className="border-amber-300 bg-amber-50 font-mono text-xs text-amber-800">
                  {t.alias} · {t.model} · {t.days_left}d
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model × Key matrix</CardTitle>
          <CardDescription>
            Remaining free quota per key. Routing skips exhausted cells automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!radar || radar.models.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No trial rows yet. Add an upstream key (provider presets seed trials automatically) or click
              “Reseed trials”.
            </div>
          ) : (
            <div className="space-y-5">
              {radar.models.map((model) => (
                <div key={model.model} className="border-b pb-4 last:border-0 last:pb-0">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{model.model}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {model.kind}
                      </Badge>
                      {model.live_keys === 0 && <Badge variant="destructive" className="text-[10px]">all exhausted</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {fmtTokens(model.total_remaining)} / {fmtTokens(model.total_limit)} free left ·{' '}
                      {model.live_keys}/{model.keys.length} keys live
                    </span>
                  </div>
                  <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
                    {model.keys.map((cell) => (
                      <div
                        key={cell.key_id}
                        className={`rounded-lg border p-2 ${cell.exhausted ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="truncate font-medium">{cell.alias}</span>
                          <span className="ml-2 shrink-0 font-mono text-muted-foreground">
                            {fmtTokens(cell.remaining)} left
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${
                              cell.pct_used >= 100
                                ? 'bg-rose-500'
                                : cell.pct_used >= 75
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, cell.pct_used)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>
                            {fmtTokens(cell.used)} / {fmtTokens(cell.limit_amount)} used
                          </span>
                          <span>exp {fmtDate(cell.expires_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  )
}
