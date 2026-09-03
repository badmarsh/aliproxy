'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  fetchSavings,
  fetchUsageDaily,
  fetchUsageSummary,
  type SavingsReport,
  type UsageDailyPoint,
  type UsageSummaryData,
} from '@/lib/api-client'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtUsd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

export default function UsagePage() {
  const [days, setDays] = useState(30)
  const [savings, setSavings] = useState<SavingsReport | null>(null)
  const [summary, setSummary] = useState<UsageSummaryData | null>(null)
  const [daily, setDaily] = useState<UsageDailyPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, sum, d] = await Promise.all([fetchSavings(), fetchUsageSummary(days), fetchUsageDaily(days)])
      setSavings(s)
      setSummary(sum)
      setDaily(d)
    } catch (err: any) {
      setError(err.message || 'Failed to load usage')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    load()
  }, [load])

  const chartData = daily.map((d) => ({
    ...d,
    label: new Date(d.date + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }))

  return (
    <AppShell title="Usage & Savings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Usage &amp; Savings</h2>
          <p className="text-sm text-muted-foreground">
            Every token below ran on free-trial quota. The meter shows what it would have cost at list price.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error} — is the proxy server running? (<code>npm run proxy</code>)
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-300 bg-emerald-50/50">
          <CardHeader className="pb-2">
            <CardDescription>Spend avoided (est.)</CardDescription>
            <CardTitle className="text-3xl text-emerald-600">
              {savings ? fmtUsd(savings.estimated_spend_avoided_usd) : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">at catalog list prices, all-time</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Free tokens harvested</CardDescription>
            <CardTitle className="text-3xl">{savings ? fmtTokens(savings.free_tokens) : '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              over {savings ? savings.all_time.requests.toLocaleString() : 0} requests
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Requests ({days}d)</CardDescription>
            <CardTitle className="text-3xl">{summary ? summary.totals.requests.toLocaleString() : '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {summary ? summary.totals.errors.toLocaleString() : 0} errors ·{' '}
              {summary && summary.totals.requests > 0
                ? `${((1 - summary.totals.errors / summary.totals.requests) * 100).toFixed(1)}%`
                : '100%'}{' '}
              success
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Metered cost ({days}d)</CardDescription>
            <CardTitle className="text-3xl">{summary ? fmtUsd(summary.totals.cost_usd) : '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">what this traffic was worth</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily volume</CardTitle>
          <CardDescription>Requests per day ({days}-day window)</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No usage recorded yet. Send a request or try the Playground.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(value: any, name: any) =>
                      name === 'cost_usd' ? [fmtUsd(Number(value)), 'metered cost'] : [value, name]
                    }
                  />
                  <Area type="monotone" dataKey="requests" stroke="#10b981" strokeWidth={2} fill="url(#reqFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top models by metered value</CardTitle>
            <CardDescription>Where the free quota went</CardDescription>
          </CardHeader>
          <CardContent>
            {!summary || summary.by_model.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No model usage yet.</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.by_model.slice(0, 8)} layout="vertical" margin={{ left: 24, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUsd(Number(v))} />
                    <YAxis type="category" dataKey="model" tick={{ fontSize: 11 }} width={130} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: any) => [fmtUsd(Number(v)), 'metered']} />
                    <Bar dataKey="cost_usd" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By consumer</CardTitle>
            <CardDescription>Master key vs client keys</CardDescription>
          </CardHeader>
          <CardContent>
            {!summary || summary.by_client.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No usage yet.</div>
            ) : (
              <div className="space-y-2">
                {summary.by_client.map((client) => (
                  <div key={client.client_key_id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{client.name}</span>
                        {client.client_key_id === '__master__' && <Badge variant="outline" className="text-[10px]">master</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {client.requests.toLocaleString()} req · {fmtTokens(client.tokens)} tok · {client.errors} err
                      </div>
                    </div>
                    <span className="font-mono text-xs">{fmtUsd(client.cost_usd)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
