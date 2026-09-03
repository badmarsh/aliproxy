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
  fetchGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  type ModelGroupItem,
  type CandidateModelItem,
} from '@/lib/api-client'

export default function GroupsPage() {
  const [groups, setGroups] = useState<ModelGroupItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ id: '', display_name: '', aliases: '', candidateModels: '', capabilities: 'chat, streaming', strategy: 'first_available' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setGroups(await fetchGroups())
    } catch (err: any) {
      setError(err.message || 'Failed to load groups')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.id || !form.display_name) return
    try {
      await createGroup({
        id: form.id,
        display_name: form.display_name,
        aliases: form.aliases.split(',').map((s) => s.trim()).filter(Boolean),
        strategy: form.strategy,
        candidates: form.candidateModels
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((m, idx) => ({
            upstream_model_id: m,
            priority: idx + 1,
            capabilities: form.capabilities.split(',').map((s) => s.trim()).filter(Boolean) as CandidateModelItem["capabilities"],
          })),
        enabled: true,
      })
      setDialogOpen(false)
      setForm({ id: '', display_name: '', aliases: '', candidateModels: '', capabilities: 'chat, streaming', strategy: 'first_available' })
      await load()
    } catch (err: any) {
      alert(`Error creating group: ${err.message}`)
    }
  }

  async function handleToggle(group: ModelGroupItem) {
    try {
      await updateGroup(group.id, { enabled: !group.enabled })
      await load()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Delete group '${id}'?`)) return
    try {
      await deleteGroup(id)
      await load()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  return (
    <AppShell title="Model Groups" right={
      <Button variant="outline" size="sm" onClick={load} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </Button>
    }>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Model Groups</h2>
          <p className="text-sm text-muted-foreground">
            Client-facing model IDs mapped to prioritized upstream candidates. Capabilities gate modality:
            <code className="mx-1 rounded bg-muted px-1 font-mono text-xs">chat</code>
            <code className="mx-1 rounded bg-muted px-1 font-mono text-xs">images</code>
            <code className="mx-1 rounded bg-muted px-1 font-mono text-xs">video</code>
            <code className="mx-1 rounded bg-muted px-1 font-mono text-xs">embeddings</code>
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>Create Group</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error} — is the proxy server running? (<code>npm run proxy</code>)
        </div>
      )}

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No groups yet. Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">npm run proxy:seed-farm</code> for
            an instant demo, or create one above.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.id} className={`flex flex-col justify-between ${!group.enabled ? 'opacity-50' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="font-mono text-base font-bold">{group.id}</CardTitle>
                    <CardDescription className="text-xs">{group.display_name}</CardDescription>
                  </div>
                  <Badge variant={group.enabled ? 'default' : 'secondary'} className="text-xs">
                    {group.strategy}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-3 pb-3">
                {group.aliases.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Aliases:</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {group.aliases.map((alias) => (
                        <Badge key={alias} variant="outline" className="font-mono text-xs">
                          {alias}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Upstream candidates ({group.candidates.length}) · keys: {group.key_ids.length}
                  </p>
                  <div className="mt-1 space-y-1 font-mono text-xs">
                    {group.candidates.map((cand, idx) => (
                      <div key={cand.upstream_model_id} className="flex items-center justify-between text-muted-foreground">
                        <span>
                          {idx + 1}. {cand.upstream_model_id}
                        </span>
                        <span className="rounded bg-muted px-1 text-[10px]">{cand.capabilities.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
              <div className="flex items-center justify-end gap-2 border-t p-4 pt-0 mt-3">
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => handleToggle(group)}>
                  {group.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={() => handleDelete(group.id)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <form onSubmit={handleCreate}>
            <DialogHeader>
              <DialogTitle>Create Model Group</DialogTitle>
              <DialogDescription>
                A client-facing model ID and its upstream candidates in priority order.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="gid">Group ID (model name clients use)</Label>
                <Input id="gid" placeholder="e.g. qwen3.8-plus" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gname">Display name</Label>
                <Input id="gname" placeholder="e.g. Qwen 3.8 Plus (trial pool)" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="galiases">Aliases (comma-separated)</Label>
                <Input id="galiases" placeholder="gpt-4o-mini, claude-3-haiku" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="gcands">Candidates in priority order (comma-separated)</Label>
                <Input id="gcands" placeholder="qwen3.8-plus-2026-08-01, qwen3.8-plus" value={form.candidateModels} onChange={(e) => setForm({ ...form, candidateModels: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="gcap">Capabilities</Label>
                  <Input id="gcap" value={form.capabilities} onChange={(e) => setForm({ ...form, capabilities: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="gstrat">Strategy</Label>
                  <select
                    id="gstrat"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.strategy}
                    onChange={(e) => setForm({ ...form, strategy: e.target.value })}
                  >
                    <option value="first_available">first_available</option>
                    <option value="round_robin">round_robin</option>
                    <option value="least_recently_used">least_recently_used</option>
                    <option value="weighted">weighted</option>
                  </select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">Save Group</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
