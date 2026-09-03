'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  fetchKeys,
  fetchGroups,
  fetchStatsSummary,
  fetchLogs,
  fetchHealth,
  fetchConfig,
  createKey,
  updateKey,
  deleteKey,
  testKey,
  refreshKeyQuota,
  createGroup,
  updateGroup,
  deleteGroup,
  fetchSavings,
  fetchTrialRadar,
  fetchExpiringTrials,
  fetchProviders,
  sweepKeys,
  type ApiKeyItem,
  type ModelGroupItem,
  type StatsSummary,
  type RequestLogItem,
  type SavingsReport,
  type TrialRadar,
  type ExpiringTrial,
  type SweepReport,
  type ProviderPresetItem,
} from '@/lib/api-client'

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Data states
  const [keys, setKeys] = useState<ApiKeyItem[]>([])
  const [groups, setGroups] = useState<ModelGroupItem[]>([])
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [logs, setLogs] = useState<RequestLogItem[]>([])
  const [health, setHealth] = useState<{ status: string; uptime_seconds: number; proxy_version: string } | null>(null)
  const [proxyConfig, setProxyConfig] = useState<any>(null)

  // Trial Farm states
  const [savings, setSavings] = useState<SavingsReport | null>(null)
  const [radar, setRadar] = useState<TrialRadar | null>(null)
  const [expiring, setExpiring] = useState<ExpiringTrial[]>([])
  const [providers, setProviders] = useState<ProviderPresetItem[]>([])
  const [sweeping, setSweeping] = useState(false)
  const [sweepResult, setSweepResult] = useState<SweepReport | null>(null)

  // Modals & Action states
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [newKeyData, setNewKeyData] = useState({
    alias: '',
    secret: '',
    base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    region: 'ap-southeast-1',
  })
  const [testingKeyId, setTestingKeyId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null)

  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [newGroupData, setNewGroupData] = useState({
    id: '',
    display_name: '',
    aliases: '',
    candidateModels: '',
    strategy: 'first_available',
  })

  // Load data
  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const [keysData, groupsData, statsData, logsData, healthData, configData, savingsData, radarData, expiringData, providersData] = await Promise.allSettled([
        fetchKeys(),
        fetchGroups(),
        fetchStatsSummary(),
        fetchLogs(50),
        fetchHealth(),
        fetchConfig(),
        fetchSavings(),
        fetchTrialRadar(),
        fetchExpiringTrials(7),
        fetchProviders(),
      ])

      if (keysData.status === 'fulfilled') setKeys(keysData.value)
      if (groupsData.status === 'fulfilled') setGroups(groupsData.value)
      if (statsData.status === 'fulfilled') setStats(statsData.value)
      if (logsData.status === 'fulfilled') setLogs(logsData.value)
      if (healthData.status === 'fulfilled') setHealth(healthData.value)
      if (configData.status === 'fulfilled') setProxyConfig(configData.value)
      if (savingsData.status === 'fulfilled') setSavings(savingsData.value)
      if (radarData.status === 'fulfilled') setRadar(radarData.value)
      if (expiringData.status === 'fulfilled') setExpiring(expiringData.value)
      if (providersData.status === 'fulfilled') setProviders(providersData.value)
    } catch (err: any) {
      setError(err.message || 'Failed to connect to proxy server')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 10000) // auto-refresh every 10s
    return () => clearInterval(interval)
  }, [])

  // Key operations
  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault()
    if (!newKeyData.alias || !newKeyData.secret || !newKeyData.base_url) return
    try {
      await createKey(newKeyData)
      setKeyDialogOpen(false)
      setNewKeyData({
        alias: '',
        secret: '',
        base_url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        region: 'ap-southeast-1',
      })
      await loadData()
    } catch (err: any) {
      alert(`Error creating key: ${err.message}`)
    }
  }

  async function handleToggleKey(key: ApiKeyItem) {
    try {
      await updateKey(key.id, { enabled: !key.enabled })
      await loadData()
    } catch (err: any) {
      alert(`Error updating key: ${err.message}`)
    }
  }

  async function handleDeleteKey(id: string) {
    if (!confirm('Are you sure you want to delete this key?')) return
    try {
      await deleteKey(id)
      await loadData()
    } catch (err: any) {
      alert(`Error deleting key: ${err.message}`)
    }
  }

  async function handleTestKey(id: string) {
    setTestingKeyId(id)
    setTestResult(null)
    try {
      const res = await testKey(id)
      setTestResult({
        id,
        success: res.success,
        message: res.success
          ? `Connected! Found ${res.models_count || 0} models (${res.latency_ms}ms)`
          : `Failed: ${res.error || 'Unknown error'}`,
      })
      await loadData()
    } catch (err: any) {
      setTestResult({ id, success: false, message: err.message })
    } finally {
      setTestingKeyId(null)
    }
  }

  async function handleRefreshQuota(id: string) {
    setTestingKeyId(id)
    try {
      await refreshKeyQuota(id)
      await loadData()
    } catch (err: any) {
      alert(`Error refreshing quota: ${err.message}`)
    } finally {
      setTestingKeyId(null)
    }
  }

  // Trial Farm operations
  async function handleSweep() {
    setSweeping(true)
    setSweepResult(null)
    try {
      const report = await sweepKeys()
      setSweepResult(report)
      await loadData()
    } catch (err: any) {
      alert(`Sweep failed: ${err.message}`)
    } finally {
      setSweeping(false)
    }
  }

  // Group operations
  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newGroupData.id || !newGroupData.display_name) return
    try {
      const aliases = newGroupData.aliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
      const models = newGroupData.candidateModels
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)

      await createGroup({
        id: newGroupData.id,
        display_name: newGroupData.display_name,
        aliases,
        strategy: newGroupData.strategy,
        candidates: models.map((m, idx) => ({
          upstream_model_id: m,
          priority: idx + 1,
          capabilities: ['chat', 'streaming', 'tools'],
        })),
        enabled: true,
      })
      setGroupDialogOpen(false)
      setNewGroupData({
        id: '',
        display_name: '',
        aliases: '',
        candidateModels: '',
        strategy: 'first_available',
      })
      await loadData()
    } catch (err: any) {
      alert(`Error creating group: ${err.message}`)
    }
  }

  async function handleToggleGroup(group: ModelGroupItem) {
    try {
      await updateGroup(group.id, { enabled: !group.enabled })
      await loadData()
    } catch (err: any) {
      alert(`Error updating group: ${err.message}`)
    }
  }

  async function handleDeleteGroup(id: string) {
    if (!confirm(`Are you sure you want to delete group '${id}'?`)) return
    try {
      await deleteGroup(id)
      await loadData()
    } catch (err: any) {
      alert(`Error deleting group: ${err.message}`)
    }
  }

  const activeKeysCount = keys.filter((k) => k.enabled && k.status !== 'invalid' && k.status !== 'disabled').length
  const activeGroupsCount = groups.filter((g) => g.enabled).length

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <div className="flex flex-col sm:gap-4 sm:py-4">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-tight">Aliproxy 2026</h1>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Ultimate Proxy Suite
              </p>
            </div>
            {health ? (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Online (v{health.proxy_version})
              </Badge>
            ) : (
              <Badge variant="destructive">Offline</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </header>

        <nav className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 pb-1" aria-label="Main navigation">
          {[
            { href: '/', label: 'Overview', active: true },
            { href: '/groups', label: 'Groups' },
            { href: '/studio', label: 'Studio' },
            { href: '/quota-radar', label: 'Quota Radar' },
            { href: '/client-keys', label: 'Client Keys' },
            { href: '/usage', label: 'Usage & Savings' },
            { href: '/playground', label: 'Playground' },
            { href: '/metrics', label: 'Metrics' },
            { href: '/settings', label: 'Settings' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                item.active
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
          <Tabs defaultValue="overview" className="space-y-6" onValueChange={setActiveTab}>
            <div className="flex items-center">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="keys">API Keys ({keys.length})</TabsTrigger>
                <TabsTrigger value="groups">Model Groups ({groups.length})</TabsTrigger>
                <TabsTrigger value="metrics">Metrics & Logs</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </div>

            {/* OVERVIEW TAB */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total API Keys</CardDescription>
                    <CardTitle className="text-3xl">{keys.length}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-emerald-600">{activeKeysCount} eligible</span>,{' '}
                      {keys.length - activeKeysCount} inactive
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Configured Groups</CardDescription>
                    <CardTitle className="text-3xl">{groups.length}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-emerald-600">{activeGroupsCount} active</span>,{' '}
                      {groups.length - activeGroupsCount} disabled
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Requests Processed</CardDescription>
                    <CardTitle className="text-3xl">{stats?.total_requests ?? 0}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      {stats?.requests_last_hour ?? 0} in the last hour
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Average Latency</CardDescription>
                    <CardTitle className="text-3xl">
                      {stats?.avg_latency_ms ? `${stats.avg_latency_ms} ms` : '—'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">Across all successful requests</div>
                  </CardContent>
                </Card>
              </div>

              {/* TRIAL FARM ROW */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="border-emerald-300 bg-emerald-50/50">
                  <CardHeader className="pb-2">
                    <CardDescription>Spend avoided (est.)</CardDescription>
                    <CardTitle className="text-3xl text-emerald-600">
                      {savings ? `$${savings.estimated_spend_avoided_usd.toFixed(savings.estimated_spend_avoided_usd < 10 ? 4 : 2)}` : '—'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      {savings ? `${savings.free_tokens.toLocaleString()} free tokens harvested` : 'start routing to save'}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Free tokens remaining</CardDescription>
                    <CardTitle className="text-3xl">
                      {radar?.totals
                        ? radar.totals.free_tokens_remaining >= 1_000_000
                          ? `${(radar.totals.free_tokens_remaining / 1_000_000).toFixed(1)}M`
                          : radar.totals.free_tokens_remaining.toLocaleString()
                        : '—'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      + {radar?.totals.free_calls_remaining ?? 0} image/video calls ·{' '}
                      <a href="/quota-radar" className="font-semibold text-foreground underline underline-offset-2">
                        radar →
                      </a>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Trials expiring ≤ 7d</CardDescription>
                    <CardTitle className={`text-3xl ${expiring.length > 0 ? 'text-amber-600' : ''}`}>
                      {expiring.length}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs text-muted-foreground">
                      {expiring.length > 0 ? `${expiring.length} quotas to burn first` : 'nothing urgent 🎉'}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Key Farm Health</CardDescription>
                    <CardTitle className="text-3xl">
                      <span className="text-emerald-600">{activeKeysCount}</span>
                      <span className="text-lg text-muted-foreground"> / {keys.length}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" size="sm" className="mt-1 h-7 text-xs" onClick={handleSweep} disabled={sweeping}>
                      {sweeping ? 'Sweeping…' : 'Run sweep'}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {sweepResult && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Sweep complete — {sweepResult.keys_valid}/{sweepResult.keys_checked} keys valid ·{' '}
                  {sweepResult.trials_seeded} trial rows seeded
                  {sweepResult.keys_failed > 0 && (
                    <span className="text-rose-700"> · {sweepResult.keys_failed} failed (see Keys tab)</span>
                  )}
                </div>
              )}

              {expiring.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">⏰ Burning soon:</span>
                  {expiring.slice(0, 8).map((t, i) => (
                    <Badge key={i} variant="outline" className="border-amber-300 bg-amber-50 font-mono text-[10px] text-amber-800">
                      {t.alias} · {t.model} · {t.days_left}d
                    </Badge>
                  ))}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="lg:col-span-4">
                  <CardHeader>
                    <CardTitle>Recent Request Activity</CardTitle>
                    <CardDescription>Latest API calls routed through the proxy</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {logs.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground">
                        No requests recorded yet. Send requests to <code className="text-xs bg-muted px-1.5 py-0.5 rounded">http://127.0.0.1:8080/v1/chat/completions</code>.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {logs.slice(0, 5).map((log) => (
                          <div key={log.id} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm font-medium">{log.requested_model}</span>
                                {log.resolved_group_id && (
                                  <Badge variant="outline" className="text-xs">
                                    {log.resolved_group_id}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground font-mono">
                                → {log.upstream_model_id || 'unresolved'} · {new Date(log.timestamp).toLocaleTimeString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <Badge
                                variant={log.status_code >= 200 && log.status_code < 300 ? 'default' : 'destructive'}
                                className="text-xs"
                              >
                                {log.status_code}
                              </Badge>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {log.latency_ms}ms {log.ttft_ms ? `(TTFT: ${log.ttft_ms}ms)` : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="lg:col-span-3">
                  <CardHeader>
                    <CardTitle>Proxy Information</CardTitle>
                    <CardDescription>Local runtime status</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm">
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Endpoint</span>
                      <code className="font-mono text-xs font-semibold">http://127.0.0.1:8080/v1</code>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Default Region</span>
                      <span className="font-mono text-xs">{proxyConfig?.routing?.defaultRegion || 'ap-southeast-1'}</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Request Timeout</span>
                      <span className="font-mono text-xs">{proxyConfig?.proxy?.request_timeout_seconds || 120}s</span>
                    </div>
                    <div className="flex justify-between border-b pb-2">
                      <span className="text-muted-foreground">Stream Timeout</span>
                      <span className="font-mono text-xs">{proxyConfig?.proxy?.stream_idle_timeout_seconds || 60}s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Uptime</span>
                      <span className="font-mono text-xs">
                        {health ? `${Math.floor(health.uptime_seconds / 60)} minutes` : '—'}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* API KEYS TAB */}
            <TabsContent value="keys" className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">API Key Management</h2>
                  <p className="text-sm text-muted-foreground">
                    Keys are stored AES-256-GCM encrypted in SQLite. Secrets are never displayed plaintext.
                  </p>
                </div>
                <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>Add New Key</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[480px]">
                    <form onSubmit={handleCreateKey}>
                      <DialogHeader>
                        <DialogTitle>Add API Key</DialogTitle>
                        <DialogDescription>
                          Enter the DashScope API key details. It will be validated and encrypted immediately.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="provider">Provider</Label>
                          <select
                            id="provider"
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={providers.find((p) => p.base_url === newKeyData.base_url)?.id || ''}
                            onChange={(e) => {
                              const preset = providers.find((p) => p.id === e.target.value)
                              if (preset) setNewKeyData({ ...newKeyData, base_url: preset.base_url, region: preset.region })
                            }}
                          >
                            <option value="">Custom…</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-muted-foreground">
                            Provider presets seed free-trial quotas automatically (Quota Radar). Need a key?{' '}
                            <a
                              href="https://bailian.console.alibabacloud.com/?tab=model#/api-key"
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline underline-offset-2"
                            >
                              Open Model Studio → API Keys ↗
                            </a>
                          </p>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="alias">Alias / Workspace Name</Label>
                          <Input
                            id="alias"
                            placeholder="e.g. Trial Account #1"
                            value={newKeyData.alias}
                            onChange={(e) => setNewKeyData({ ...newKeyData, alias: e.target.value })}
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="secret">API Key Secret</Label>
                          <Input
                            id="secret"
                            type="password"
                            placeholder="sk-ws-H... or sk-..."
                            value={newKeyData.secret}
                            onChange={(e) => setNewKeyData({ ...newKeyData, secret: e.target.value })}
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="base_url">Base URL (OpenAI Compatible Endpoint)</Label>
                          <Input
                            id="base_url"
                            placeholder="https://ws-xxx.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
                            value={newKeyData.base_url}
                            onChange={(e) => setNewKeyData({ ...newKeyData, base_url: e.target.value })}
                            required
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button type="submit">Encrypt & Save Key</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              {testResult && (
                <div
                  className={`p-3 rounded-lg text-sm border ${
                    testResult.success
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : 'bg-rose-50 border-rose-300 text-rose-800'
                  }`}
                >
                  {testResult.message}
                </div>
              )}

              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {keys.map((key) => (
                      <div
                        key={key.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4 ${
                          !key.enabled || key.status === 'disabled' ? 'opacity-60 bg-muted/20' : ''
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-base">{key.alias}</span>
                            <Badge
                              variant={
                                key.status === 'active'
                                  ? 'default'
                                  : key.status === 'quota_exhausted' || key.status === 'rate_limited'
                                  ? 'secondary'
                                  : 'destructive'
                              }
                              className="text-xs"
                            >
                              {key.status}
                            </Badge>
                            <Badge variant="outline" className="text-xs font-mono">
                              {key.key_type}
                            </Badge>
                          </div>
                          <p className="text-xs font-mono text-muted-foreground">
                            Fingerprint: {key.fingerprint} · Region: {key.region}
                          </p>
                          <p className="text-xs text-muted-foreground truncate max-w-md font-mono">{key.base_url}</p>
                          {key.last_error_message && (
                            <p className="text-xs text-destructive font-mono">
                              Last Error: {key.last_error_message}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTestKey(key.id)}
                            disabled={testingKeyId === key.id}
                          >
                            {testingKeyId === key.id ? 'Testing...' : 'Test'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRefreshQuota(key.id)}
                            disabled={testingKeyId === key.id}
                          >
                            Refresh
                          </Button>
                          <Button
                            variant={key.enabled ? 'outline' : 'default'}
                            size="sm"
                            onClick={() => handleToggleKey(key)}
                          >
                            {key.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteKey(key.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* MODEL GROUPS TAB */}
            <TabsContent value="groups" className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Model Groups</h2>
                  <p className="text-sm text-muted-foreground">
                    Defines how client model requests are mapped and prioritized to DashScope snapshots.
                  </p>
                </div>
                <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>Create Custom Group</Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[480px]">
                    <form onSubmit={handleCreateGroup}>
                      <DialogHeader>
                        <DialogTitle>Create Model Group</DialogTitle>
                        <DialogDescription>
                          Configure a client-facing group ID and its upstream candidate models.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="gid">Group ID (Model Name)</Label>
                          <Input
                            id="gid"
                            placeholder="e.g. qwen3.7-plus"
                            value={newGroupData.id}
                            onChange={(e) => setNewGroupData({ ...newGroupData, id: e.target.value })}
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="gname">Display Name</Label>
                          <Input
                            id="gname"
                            placeholder="e.g. Qwen 3.7 Plus"
                            value={newGroupData.display_name}
                            onChange={(e) => setNewGroupData({ ...newGroupData, display_name: e.target.value })}
                            required
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="galiases">Aliases (comma-separated)</Label>
                          <Input
                            id="galiases"
                            placeholder="gpt-4o-mini, claude-3-haiku"
                            value={newGroupData.aliases}
                            onChange={(e) => setNewGroupData({ ...newGroupData, aliases: e.target.value })}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="gcands">Candidates in priority order (comma-separated)</Label>
                          <Input
                            id="gcands"
                            placeholder="qwen3.7-plus-2026-05-26, qwen3.7-plus"
                            value={newGroupData.candidateModels}
                            onChange={(e) => setNewGroupData({ ...newGroupData, candidateModels: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button type="submit">Save Group</Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {groups.map((group) => (
                  <Card key={group.id} className={`flex flex-col justify-between ${!group.enabled ? 'opacity-50' : ''}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base font-bold font-mono">{group.id}</CardTitle>
                          <CardDescription className="text-xs">{group.display_name}</CardDescription>
                        </div>
                        <Badge variant={group.enabled ? 'default' : 'secondary'} className="text-xs">
                          {group.strategy}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pb-3 flex-1">
                      {group.aliases.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Aliases:</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {group.aliases.map((alias) => (
                              <Badge key={alias} variant="outline" className="text-xs font-mono">
                                {alias}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Upstream Candidates ({group.candidates.length}):
                        </p>
                        <div className="space-y-1 mt-1 font-mono text-xs">
                          {group.candidates.map((cand, idx) => (
                            <div key={cand.upstream_model_id} className="flex items-center justify-between text-muted-foreground">
                              <span>
                                {idx + 1}. {cand.upstream_model_id}
                              </span>
                              <span className="text-[10px] bg-muted px-1 rounded">
                                {cand.capabilities.join(', ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                    <div className="flex items-center justify-end gap-2 p-4 pt-0 border-t mt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleGroup(group)}
                        className="text-xs"
                      >
                        {group.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteGroup(group.id)}
                        className="text-xs text-destructive hover:text-destructive"
                      >
                        Delete
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* METRICS & LOGS TAB */}
            <TabsContent value="metrics" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Detailed Request Logs</CardTitle>
                  <CardDescription>Live query audit logs</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground text-left">
                          <th className="py-2.5 pr-4">Timestamp</th>
                          <th className="py-2.5 pr-4">Requested Model</th>
                          <th className="py-2.5 pr-4">Resolved Group</th>
                          <th className="py-2.5 pr-4">Upstream Target</th>
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
                              No request logs available.
                            </td>
                          </tr>
                        ) : (
                          logs.map((log) => (
                            <tr key={log.id} className="hover:bg-muted/40">
                              <td className="py-2 pr-4 text-muted-foreground">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="py-2 pr-4 font-semibold">{log.requested_model}</td>
                              <td className="py-2 pr-4 text-muted-foreground">{log.resolved_group_id || '—'}</td>
                              <td className="py-2 pr-4 text-muted-foreground">{log.upstream_model_id || '—'}</td>
                              <td className="py-2 pr-4">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                    log.status_code >= 200 && log.status_code < 300
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {log.status_code}
                                </span>
                              </td>
                              <td className="py-2 pr-4">{log.latency_ms}ms</td>
                              <td className="py-2 pr-4 text-muted-foreground">
                                {log.prompt_tokens != null ? `${log.prompt_tokens} / ${log.completion_tokens || 0}` : '—'}
                              </td>
                              <td className="py-2">
                                {log.streaming ? (
                                  <Badge variant="outline" className="text-[10px]">
                                    stream
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">sync</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* SETTINGS TAB */}
            <TabsContent value="settings" className="space-y-4">
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Proxy Server Configuration</CardTitle>
                    <CardDescription>Configuration loaded from environment variables and config</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm font-mono">
                    <div className="grid grid-cols-2 border-b pb-2">
                      <span className="text-muted-foreground font-sans">Listen Port</span>
                      <span>{proxyConfig?.proxy?.port ?? 8080}</span>
                    </div>
                    <div className="grid grid-cols-2 border-b pb-2">
                      <span className="text-muted-foreground font-sans">Listen Host</span>
                      <span>{proxyConfig?.proxy?.host ?? '127.0.0.1'}</span>
                    </div>
                    <div className="grid grid-cols-2 border-b pb-2">
                      <span className="text-muted-foreground font-sans">Request Timeout</span>
                      <span>{proxyConfig?.proxy?.request_timeout_seconds ?? 120} seconds</span>
                    </div>
                    <div className="grid grid-cols-2 border-b pb-2">
                      <span className="text-muted-foreground font-sans">Stream Idle Timeout</span>
                      <span>{proxyConfig?.proxy?.stream_idle_timeout_seconds ?? 60} seconds</span>
                    </div>
                    <div className="grid grid-cols-2 border-b pb-2">
                      <span className="text-muted-foreground font-sans">Default Region</span>
                      <span>{proxyConfig?.routing?.defaultRegion ?? 'ap-southeast-1'}</span>
                    </div>
                    <div className="grid grid-cols-2 border-b pb-2">
                      <span className="text-muted-foreground font-sans">Max Retries</span>
                      <span>{proxyConfig?.routing?.maxRetries ?? 3}</span>
                    </div>
                    <div className="grid grid-cols-2">
                      <span className="text-muted-foreground font-sans">Circuit Breaker</span>
                      <span>5 failures → 60s cooldown</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Usage Instructions</CardTitle>
                    <CardDescription>Connect any OpenAI-compatible client</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-xs font-mono bg-muted/40 p-4 rounded-lg">
                    <p className="font-sans font-medium text-sm text-foreground">Python SDK Example:</p>
                    <pre className="p-3 bg-background rounded border overflow-x-auto text-[11px]">
{`from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="aliproxy-local-key"
)

response = client.chat.completions.create(
    model="qwen3.7-plus",  # routes to latest snapshot
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")`}
                    </pre>

                    <p className="font-sans font-medium text-sm text-foreground pt-2">cURL Example:</p>
                    <pre className="p-3 bg-background rounded border overflow-x-auto text-[11px]">
{`curl -X POST http://127.0.0.1:8080/v1/chat/completions \\
  -H "Authorization: Bearer aliproxy-local-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen3.7-plus",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'`}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}