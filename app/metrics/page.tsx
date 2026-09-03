'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
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
  fetchStatsSummary,
  fetchLogs,
  fetchTimeline,
  fetchHealth,
  type StatsSummary,
  type RequestLogItem,
  type TimelinePoint,
} from '@/lib/api-client'

export default function MetricsPage() {
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [logs, setLogs] = useState<RequestLogItem[]>([])
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [health, setHealth] = useState<{ status: string; uptime_seconds: number; proxy_version: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hours, setHours] = useState(24)
  const [modelFilter, setModelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'error'>('all')
  const [modeFilter, setModeFilter] = useState<'all' | 'stream' | 'sync'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, l, t, h] = await Promise.all([
        fetchStatsSummary(),
        fetchLogs(150, {
          model: modelFilter.trim() || undefined,
          status: statusFilter === 'all' ? undefined : statusFilter,
          mode: modeFilter === 'all' ? undefined : modeFilter,
        }),
        fetchTimeline(hours),
        fetchHealth(),
      ])
      setStats(s)
      setLogs(l)
      setTimeline(t)
      setHealth(h)
    } catch (err: any) {
      setError(err.message || 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }, [hours, modelFilter, statusFilter, modeFilter])

  useEffect(() => {
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [load])

  const chartData = timeline.map((t) => ({
    ...t,
    label: new Date(t.hour.replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit' }),
  }))

  return (
    <AppShell
      title="Metrics"
      right={
        <div className="flex items-center gap-1">
          {[6, 24, 72].map((h) => (
            <Button key={h} variant={hours === h ? 'default' : 'outline'} size="sm" onClick={() => setHours(h)}>
              {h}h
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? '…' : 'Refresh'}
          </Button>
        </div>
      }
    >
      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error} — is the proxy server running? (<code>npm run proxy</code>)
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total requests</CardDescription>
            <CardTitle className="text-3xl">{stats?.total_requests?.toLocaleString() ?? '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">{stats?.requests_last_hour ?? 0} in the last hour</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg latency</CardDescription>
            <CardTitle className="text-3xl">{stats?.avg_latency_ms ? `${stats.avg_latency_ms} ms` : '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              p50 {stats?.p50_latency_ms ?? 0} ms · p95 {stats?.p95_latency_ms ?? 0} ms
            </div>
          </CardContent>
        </Card>
        <Card className={stats && (stats.p95_latency_ms ?? 0) > 3000 ? 'border-amber-300' : ''}>
          <CardHeader className="pb-2">
            <CardDescription>Latency p95</CardDescription>
            <CardTitle className={`text-3xl ${stats && (stats.p95_latency_ms ?? 0) > 3000 ? 'text-amber-600' : ''}`}>
              {stats?.p95_latency_ms ? `${stats.p95_latency_ms} ms` : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">worst 5% of recent 1k requests</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Proxy uptime</CardDescription>
            <CardTitle className="text-3xl">
              {health ? `${Math.floor(health.uptime_seconds / 3600)}h ${Math.floor((health.uptime_seconds % 3600) / 60)}m` : '—'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">v{health?.proxy_version ?? '?'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active groups</CardDescription>
            <CardTitle className="text-3xl">{stats ? Object.keys(stats.groups).length : '—'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">serving traffic</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request timeline ({hours}h)</CardTitle>
          <CardDescription>Requests vs errors per hour</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No traffic recorded yet.</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="req" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#18181b" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#18181b" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="requests" stroke="#18181b" strokeWidth={2} fill="url(#req)" />
                  <Area type="monotone" dataKey="errors" stroke="#e11d48" strokeWidth={2} fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Request log</CardTitle>
            <CardDescription>Live audit of everything the farm routed</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              placeholder="filter model…"
              className="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">all statuses</option>
              <option value="ok">ok only</option>
              <option value="error">errors only</option>
            </select>
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value as any)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="all">all modes</option>
              <option value="stream">stream</option>
              <option value="sync">sync</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2.5 pr-4">Time</th>
                  <th className="py-2.5 pr-4">Model</th>
                  <th className="py-2.5 pr-4">Group</th>
                  <th className="py-2.5 pr-4">Upstream</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4">Latency</th>
                  <th className="py-2.5 pr-4">Tokens</th>
                  <th className="py-2.5">Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono text-xs">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No request logs yet.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/40">
                      <td className="py-2 pr-4 text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td className="py-2 pr-4 font-semibold">{log.requested_model}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{log.resolved_group_id || '—'}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{log.upstream_model_id || '—'}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                            log.status_code >= 200 && log.status_code < 300
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {log.status_code}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        {log.latency_ms}ms{log.ttft_ms ? ` (TTFT ${log.ttft_ms}ms)` : ''}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {log.prompt_tokens != null ? `${log.prompt_tokens} / ${log.completion_tokens || 0}` : '—'}
                      </td>
                      <td className="py-2">
                        {log.streaming ? <Badge variant="outline" className="text-[10px]">stream</Badge> : <span className="text-muted-foreground">sync</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
