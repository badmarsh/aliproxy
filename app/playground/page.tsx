'use client'

import { useEffect, useRef, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchGroups, playgroundChat, type ModelGroupItem } from '@/lib/api-client'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function PlaygroundPage() {
  const [groups, setGroups] = useState<ModelGroupItem[]>([])
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [meta, setMeta] = useState<{ group?: string; upstream?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchGroups()
      .then((g) => {
        const enabled = g.filter((x) => x.enabled)
        setGroups(enabled)
        if (enabled.length > 0 && !model) setModel(enabled[0].id)
      })
      .catch((err) => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || !model || streaming) return

    const nextMessages: Message[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }]
    setMessages(nextMessages)
    setInput('')
    setStreaming(true)
    setError(null)
    setMeta(null)

    try {
      const res = await playgroundChat({
        model,
        messages: nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      })

      setMeta({ group: res.headers.get('X-Aliproxy-Group') || undefined, upstream: res.headers.get('X-Aliproxy-Upstream-Model') || undefined })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message || `Request failed (${res.status})`)
      }
      if (!res.body) throw new Error('No response stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue
          try {
            const parsed = JSON.parse(trimmed.slice(6))
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              setMessages((prev) => {
                const copy = [...prev]
                copy[copy.length - 1] = { role: 'assistant', content: copy[copy.length - 1].content + delta }
                return copy
              })
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err: any) {
      setError(err.message)
      setMessages((prev) => prev.slice(0, -1))
    } finally {
      setStreaming(false)
    }
  }

  return (
    <AppShell title="Playground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Playground</h2>
          <p className="text-sm text-muted-foreground">
            Chat against any group — routed, logged, and trial-metered exactly like production traffic.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {groups.length === 0 && <option value="">no groups</option>}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.id}
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setMessages([])}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex h-[52vh] flex-col gap-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <p>
                  No groups yet? Run <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">npm run proxy:seed-farm</code>{' '}
                  for an instant Echo demo.
                </p>
                <p>Then say something — streaming works.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === 'user' ? 'bg-foreground text-background' : 'border bg-background'
                  }`}
                >
                  {m.content || (streaming && i === messages.length - 1 ? '▍' : '')}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {(meta?.group || meta?.upstream) && (
            <div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
              routed via
              {meta.group && <Badge variant="outline" className="font-mono text-[10px]">{meta.group}</Badge>}
              {meta.upstream && <Badge variant="outline" className="font-mono text-[10px]">{meta.upstream}</Badge>}
            </div>
          )}

          <div className="flex gap-2 border-t p-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={groups.length === 0 ? 'Create a group first…' : 'Message the farm…'}
              disabled={streaming || groups.length === 0}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button onClick={send} disabled={streaming || !input.trim() || !model}>
              {streaming ? 'Streaming…' : 'Send'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
      )}
    </AppShell>
  )
}
