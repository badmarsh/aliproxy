'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
} from '@/components/ui/dialog'
import {
  fetchClientKeys,
  createClientKey,
  updateClientKey,
  deleteClientKey,
  rotateClientKey,
  fetchGroups,
  type ClientKeyItem,
  type ModelGroupItem,
} from '@/lib/api-client'

function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 10 ? 4 : 2)}`
}

export default function ClientKeysPage() {
  const [keys, setKeys] = useState<ClientKeyItem[]>([])
  const [groups, setGroups] = useState<ModelGroupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', rpm: '', dailyReq: '', dailyTokens: '', groups: '' })
  const [revealed, setRevealed] = useState<{ name: string; plaintext: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [k, g] = await Promise.allSettled([fetchClientKeys(), fetchGroups()])
      if (k.status === 'fulfilled') setKeys(k.value)
      if (g.status === 'fulfilled') setGroups(g.value)
    } catch (err: any) {
      setError(err.message || 'Failed to load client keys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    try {
      const created = await createClientKey({
        name: form.name,
        rpm_limit: form.rpm ? parseInt(form.rpm, 10) : null,
        daily_request_limit: form.dailyReq ? parseInt(form.dailyReq, 10) : null,
        daily_token_budget: form.dailyTokens ? parseInt(form.dailyTokens, 10) : null,
        allowed_group_ids: form.groups
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      })
      setRevealed({ name: created.name, plaintext: created.plaintext || '' })
      setCreateOpen(false)
      setForm({ name: '', rpm: '', dailyReq: '', dailyTokens: '', groups: '' })
      await load()
    } catch (err: any) {
      alert(`Error creating client key: ${err.message}`)
    }
  }

  async function handleToggle(key: ClientKeyItem) {
    try {
      await updateClientKey(key.id, { enabled: !key.enabled })
      await load()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  async function handleRotate(key: ClientKeyItem) {
    if (!confirm(`Rotate key "${key.name}"? The current token stops working immediately.`)) return
    setBusy(key.id)
    try {
      const rotated = await rotateClientKey(key.id)
      setRevealed({ name: rotated.name, plaintext: rotated.plaintext || '' })
      await load()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete(key: ClientKeyItem) {
    if (!confirm(`Delete client key "${key.name}"?`)) return
    try {
      await deleteClientKey(key.id)
      await load()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  return (
    <AppShell title="Client Keys">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Client Keys</h2>
          <p className="text-sm text-muted-foreground">
            Hand out <code className="rounded bg-muted px-1 font-mono text-xs">sk-aliproxy-…</code> keys instead of
            your master key — with RPM limits, daily budgets, and group allowlists.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Issue Client Key
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error} — is the proxy server running? (<code>npm run proxy</code>)
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No client keys yet. Issue one to share your trial farm without exposing the master key.
            </div>
          ) : (
            <div className="divide-y">
              {keys.map((key) => (
                <div key={key.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${!key.enabled ? 'bg-muted/20 opacity-60' : ''}`}>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{key.name}</span>
                      <Badge variant={key.enabled ? 'default' : 'secondary'} className="text-xs">
                        {key.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {key.key_prefix}…
                      </code>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {key.rpm_limit ? `${key.rpm_limit} rpm · ` : 'unlimited rpm · '}
                      {key.daily_request_limit ? `${key.daily_request_limit} req/day · ` : ''}
                      {key.daily_token_budget ? `${key.daily_token_budget.toLocaleString()} tok/day` : 'no daily cap'}
                    </p>
                    {key.allowed_group_ids.length > 0 && (
                      <p className="font-mono text-xs text-muted-foreground">groups: {key.allowed_group_ids.join(', ')}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      lifetime: {key.total_requests.toLocaleString()} req · {key.total_tokens.toLocaleString()} tok ·{' '}
                      {fmtUsd(key.total_cost_usd)} metered
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleRotate(key)} disabled={busy === key.id}>
                      {busy === key.id ? 'Rotating…' : 'Rotate'}
                    </Button>
                    <Button variant={key.enabled ? 'outline' : 'default'} size="sm" onClick={() => handleToggle(key)}>
                      {key.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(key)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How client key auth works</CardTitle>
          <CardDescription>Same OpenAI-compatible endpoints, different token</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px]">
{`curl http://127.0.0.1:8080/v1/chat/completions \\
  -H "Authorization: Bearer sk-aliproxy-…" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "aliproxy-demo", "messages": [{"role":"user","content":"hi"}]}'`}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Rate limits return <code>429</code> with <code>Retry-After</code>; budget overruns return
            <code> client_key_daily_*</code> error codes. Allowlists restrict which model groups the key may use.
          </p>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Issue Client Key</DialogTitle>
              <DialogDescription>
                The plaintext token is shown once. Budgets reset at 00:00 UTC.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="ck-name">Name</Label>
                <Input
                  id="ck-name"
                  placeholder="e.g. my-side-project"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="ck-rpm">RPM limit</Label>
                  <Input id="ck-rpm" type="number" min="1" placeholder="∞" value={form.rpm} onChange={(e) => setForm({ ...form, rpm: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ck-req">Req/day</Label>
                  <Input id="ck-req" type="number" min="1" placeholder="∞" value={form.dailyReq} onChange={(e) => setForm({ ...form, dailyReq: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ck-tok">Tok/day</Label>
                  <Input id="ck-tok" type="number" min="1" placeholder="∞" value={form.dailyTokens} onChange={(e) => setForm({ ...form, dailyTokens: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ck-groups">Allowed groups (comma-separated, empty = all)</Label>
                <Input
                  id="ck-groups"
                  placeholder={groups.slice(0, 2).map((g) => g.id).join(', ')}
                  value={form.groups}
                  onChange={(e) => setForm({ ...form, groups: e.target.value })}
                />
                {groups.length > 0 && (
                  <p className="text-xs text-muted-foreground">available: {groups.map((g) => g.id).join(', ')}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">Issue Key</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Key created — copy it now</DialogTitle>
            <DialogDescription>
              This plaintext token for “{revealed?.name}” is shown only once. Stored hashed (SHA-256).
            </DialogDescription>
          </DialogHeader>
          <pre className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-xs">{revealed?.plaintext}</pre>
          <DialogFooter>
            <Button
              onClick={() => {
                if (revealed) navigator.clipboard?.writeText(revealed.plaintext)
                setRevealed(null)
              }}
            >
              Copy &amp; Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
