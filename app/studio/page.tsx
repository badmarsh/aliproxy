'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  fetchGroups,
  playgroundChat,
  studioGenerateImage,
  studioSubmitVideo,
  studioPollVideo,
  type ModelGroupItem,
} from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Prompt block model
// ---------------------------------------------------------------------------

type CategoryId = 'subject' | 'style' | 'lighting' | 'camera' | 'mood' | 'quality' | 'custom'

interface Category {
  id: CategoryId
  label: string
  color: string // hex for accents + compiled preview
}

const CATEGORIES: Category[] = [
  { id: 'subject', label: 'Subject', color: '#10b981' },
  { id: 'style', label: 'Style', color: '#8b5cf6' },
  { id: 'lighting', label: 'Lighting', color: '#f59e0b' },
  { id: 'camera', label: 'Camera', color: '#0ea5e9' },
  { id: 'mood', label: 'Mood', color: '#f43f5e' },
  { id: 'quality', label: 'Quality', color: '#14b8a6' },
  { id: 'custom', label: 'Custom', color: '#a1a1aa' },
]

const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]))

const LIBRARY: Record<CategoryId, string[]> = {
  subject: [
    'a lone astronaut on an endless salt flat',
    'a hoarder dragon asleep on a pile of glowing API keys',
    'a neon-lit ramen stall in the rain',
    'an abandoned library reclaimed by ferns',
    'a cat astronaut floating over Saturn',
    'a violinist made of stained glass',
  ],
  style: [
    'cinematic film still, 35mm',
    'anime key visual, cel shading',
    'studio product photography',
    'loose watercolor painting',
    'retro-futurist poster art, 1960s sci-fi',
    'isometric 3D render, soft clay materials',
    'oil painting, thick impasto brushwork',
    'vaporwave gradient aesthetic',
  ],
  lighting: [
    'golden hour rim light',
    'softbox studio lighting, subtle reflections',
    'neon signage glow, wet reflections',
    'overcast diffused light',
    'dramatic chiaroscuro',
    'volumetric god rays through haze',
    'candlelit warmth, deep shadows',
  ],
  camera: [
    'wide angle, low angle shot',
    'macro lens, shallow depth of field',
    'aerial drone shot, top-down',
    'symmetrical composition, centered',
    'Dutch angle, dynamic tension',
    'extreme close-up, 85mm portrait',
    'fisheye distortion',
  ],
  mood: [
    'serene and melancholic',
    'epic and awe-inspiring',
    'cozy and intimate',
    'eerie, liminal',
    'playful and chaotic',
    'nostalgic, dreamlike',
  ],
  quality: [
    'ultra detailed, photorealistic, 8k',
    'sharp linework, high contrast',
    'textured paper, bleeding pigments',
    'screen print texture, limited palette',
    'hyperreal textures, ray-traced reflections',
  ],
  custom: [],
}

interface PromptBlock {
  id: string
  category: CategoryId
  text: string
  enabled: boolean
}

interface Template {
  name: string
  blocks: Array<{ category: CategoryId; text: string }>
  negative?: string
}

const TEMPLATES: Template[] = [
  {
    name: 'Cinematic still',
    blocks: [
      { category: 'subject', text: 'a lone astronaut on an endless salt flat' },
      { category: 'style', text: 'cinematic film still, 35mm' },
      { category: 'lighting', text: 'golden hour rim light' },
      { category: 'camera', text: 'wide angle, low angle shot' },
      { category: 'quality', text: 'ultra detailed, photorealistic, 8k' },
    ],
    negative: 'blurry, low quality, watermark, text',
  },
  {
    name: 'Product shot',
    blocks: [
      { category: 'subject', text: 'a matte black espresso machine' },
      { category: 'style', text: 'studio product photography' },
      { category: 'lighting', text: 'softbox studio lighting, subtle reflections' },
      { category: 'camera', text: 'macro lens, shallow depth of field' },
    ],
    negative: 'clutter, hands, text, harsh shadows',
  },
  {
    name: 'Anime key visual',
    blocks: [
      { category: 'subject', text: 'a young inventor girl with windblown hair' },
      { category: 'style', text: 'anime key visual, cel shading' },
      { category: 'lighting', text: 'volumetric god rays through haze' },
      { category: 'camera', text: 'Dutch angle, dynamic tension' },
      { category: 'quality', text: 'sharp linework, high contrast' },
    ],
  },
  {
    name: 'Watercolor landscape',
    blocks: [
      { category: 'subject', text: 'a misty mountain valley at dawn' },
      { category: 'style', text: 'loose watercolor painting' },
      { category: 'lighting', text: 'overcast diffused light' },
      { category: 'camera', text: 'aerial drone shot, top-down' },
      { category: 'quality', text: 'textured paper, bleeding pigments' },
    ],
  },
  {
    name: 'Retro sci-fi poster',
    blocks: [
      { category: 'subject', text: 'a monorail crossing an alien desert' },
      { category: 'style', text: 'retro-futurist poster art, 1960s sci-fi' },
      { category: 'lighting', text: 'double sun, warm haze' },
      { category: 'camera', text: 'symmetrical composition, centered' },
      { category: 'quality', text: 'screen print texture, limited palette' },
    ],
    negative: 'photorealistic, modern cars, text',
  },
]

// ---------------------------------------------------------------------------
// Gallery model
// ---------------------------------------------------------------------------

interface GalleryItem {
  id: string
  kind: 'image' | 'video'
  prompt: string
  negative: string
  model: string
  createdAt: number
  latencyMs: number | null
  status: 'done' | 'pending' | 'failed'
  images?: string[] // data URLs or remote URLs
  videoUrl?: string | null
  taskId?: string
  error?: string
}

const STORAGE_KEY = 'aliproxy.studio.v1'

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

function compilePrompt(blocks: PromptBlock[]): string {
  return blocks
    .filter((b) => b.enabled && b.text.trim())
    .map((b) => b.text.trim())
    .join(', ')
}

function toDataUrl(b64: string): string {
  // Echo returns base64 SVG ("PHN2…" = "<svg"); real upstreams return PNG/JPEG
  if (b64.startsWith('PHN2')) return `data:image/svg+xml;base64,${b64}`
  return `data:image/png;base64,${b64}`
}

function isMockUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'echo.aliproxy.local'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StudioPage() {
  const [mode, setMode] = useState<'image' | 'video'>('image')
  const [blocks, setBlocks] = useState<PromptBlock[]>(TEMPLATES[0].blocks.map((b) => ({ ...b, id: uid(), enabled: true })))
  const [negative, setNegative] = useState(TEMPLATES[0].negative || '')

  const [groups, setGroups] = useState<ModelGroupItem[]>([])
  const [imageModel, setImageModel] = useState('')
  const [videoModel, setVideoModel] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [videoSize, setVideoSize] = useState('1280*720')
  const [count, setCount] = useState(2)

  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [generating, setGenerating] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const dragIndex = useRef<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load groups + persisted state
  useEffect(() => {
    fetchGroups()
      .then((g) => {
        const enabled = g.filter((x) => x.enabled)
        setGroups(enabled)
        const firstImage = enabled.find((x) => x.candidates.some((c) => c.capabilities.includes('images')))
        const firstVideo = enabled.find((x) => x.candidates.some((c) => c.capabilities.includes('video')))
        if (firstImage) setImageModel((prev) => prev || firstImage.id)
        if (firstVideo) setVideoModel((prev) => prev || firstVideo.id)
      })
      .catch((err) => setError(err.message))

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (Array.isArray(saved.blocks)) setBlocks(saved.blocks)
        if (typeof saved.negative === 'string') setNegative(saved.negative)
        if (saved.mode) setMode(saved.mode)
        if (Array.isArray(saved.gallery)) setGallery(saved.gallery)
      }
    } catch {
      // corrupted state — start fresh
    }
  }, [])

  // Persist (debounced)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks, negative, mode, gallery: gallery.slice(0, 40) }))
      } catch {
        // storage full — drop oldest and retry once
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks, negative, mode, gallery: gallery.slice(0, 10) }))
        } catch {
          /* give up quietly */
        }
      }
    }, 400)
  }, [blocks, negative, mode, gallery])

  const imageGroups = groups.filter((g) => g.candidates.some((c) => c.capabilities.includes('images')))
  const videoGroups = groups.filter((g) => g.candidates.some((c) => c.capabilities.includes('video')))
  const chatGroups = groups.filter((g) => g.candidates.some((c) => c.capabilities.includes('chat')))
  const prompt = compilePrompt(blocks)

  // --- canvas operations ---

  function addBlock(category: CategoryId, text: string) {
    setBlocks((prev) => [...prev, { id: uid(), category, text, enabled: true }])
  }

  function updateBlock(id: string, patch: Partial<PromptBlock>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  function handleDragStart(index: number) {
    dragIndex.current = index
  }

  function handleDragEnter(index: number) {
    const from = dragIndex.current
    if (from === null || from === index) return
    setBlocks((prev) => {
      const copy = [...prev]
      const [moved] = copy.splice(from, 1)
      copy.splice(index, 0, moved)
      return copy
    })
    dragIndex.current = index
  }

  function applyTemplate(name: string) {
    const tpl = TEMPLATES.find((t) => t.name === name)
    if (!tpl) return
    setBlocks(tpl.blocks.map((b) => ({ ...b, id: uid(), enabled: true })))
    setNegative(tpl.negative || '')
  }

  function surprise() {
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
    setBlocks([
      { id: uid(), category: 'subject', text: pick(LIBRARY.subject), enabled: true },
      { id: uid(), category: 'style', text: pick(LIBRARY.style), enabled: true },
      { id: uid(), category: 'lighting', text: pick(LIBRARY.lighting), enabled: true },
      { id: uid(), category: 'camera', text: pick(LIBRARY.camera), enabled: true },
      { id: uid(), category: 'mood', text: pick(LIBRARY.mood), enabled: true },
    ])
  }

  // --- AI prompt enhancement (uses any chat-capable group on the farm) ---

  const VALID_CATS = new Set(CATEGORIES.map((c) => c.id))

  function parseEnhancedBlocks(content: string): Array<{ category: CategoryId; text: string }> {
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        const arr = JSON.parse(jsonMatch[0])
        const out: Array<{ category: CategoryId; text: string }> = []
        for (const item of arr) {
          if (item && typeof item.text === 'string' && item.text.trim()) {
            out.push({ category: VALID_CATS.has(item.category) ? item.category : 'custom', text: item.text.trim() })
          }
        }
        if (out.length > 0) return out.slice(0, 8)
      } catch {
        // fall through to line parsing
      }
    }
    // Fallback (e.g. Echo mock): meaningful lines become custom blocks
    return content
      .split('\n')
      .map((l) => l.replace(/^[-*\d.)\s]+/, '').trim())
      .filter((l) => l.length > 3)
      .slice(0, 6)
      .map((text) => ({ category: 'custom' as CategoryId, text }))
  }

  async function enhancePrompt() {
    if (enhancing || !prompt.trim()) return
    const model = chatGroups[0]?.id
    if (!model) {
      setError('No chat-capable group available for prompt enhancement — add one (e.g. aliproxy-demo).')
      return
    }
    setEnhancing(true)
    setError(null)
    try {
      const res = await playgroundChat({
        model,
        stream: false,
        messages: [
          {
            role: 'system',
            content:
              'You are a prompt engineer for an AI image/video generation canvas. Expand the user\'s idea into vivid, concrete prompt blocks. Respond ONLY with a JSON array (no markdown fences, no prose) of 5-7 objects, each {"category":"subject|style|lighting|camera|mood|quality","text":"..."}. Categories must be exactly as listed.',
          },
          { role: 'user', content: `Idea to expand: ${prompt}${negative ? `\nAvoid: ${negative}` : ''}` },
        ],
      })
      if (!res.ok) throw new Error(`Enhance failed (${res.status})`)
      const body = await res.json()
      const content: string = body?.choices?.[0]?.message?.content || ''
      const parsed = parseEnhancedBlocks(content)
      if (parsed.length === 0) throw new Error('Model returned nothing usable — try again or edit manually.')
      setBlocks(parsed.map((b) => ({ ...b, id: uid(), enabled: true })))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setEnhancing(false)
    }
  }

  // --- generation ---

  const generate = useCallback(async () => {
    if (generating || !prompt.trim()) return
    setGenerating(true)
    setError(null)
    const started = Date.now()

    try {
      if (mode === 'image') {
        if (!imageModel) throw new Error('No image-capable group — add one (e.g. echo-image via seed-farm)')
        const result = await studioGenerateImage({
          model: imageModel,
          prompt,
          negative_prompt: negative || undefined,
          n: count,
          size,
        })
        const images = (result.data || [])
          .map((d) => (d.b64_json ? toDataUrl(d.b64_json) : d.url))
          .filter(Boolean) as string[]
        setGallery((prev) => [
          {
            id: uid(),
            kind: 'image',
            prompt,
            negative,
            model: imageModel,
            createdAt: started,
            latencyMs: Date.now() - started,
            status: 'done',
            images,
          },
          ...prev,
        ])
      } else {
        if (!videoModel) throw new Error('No video-capable group — add one (e.g. echo-video via seed-farm)')
        const task = await studioSubmitVideo({
          model: videoModel,
          input: { prompt, negative_prompt: negative || undefined },
          parameters: { size: videoSize },
        })
        const taskId = task.output?.task_id
        const item: GalleryItem = {
          id: uid(),
          kind: 'video',
          prompt,
          negative,
          model: videoModel,
          createdAt: started,
          latencyMs: null,
          status: 'pending',
          taskId,
        }
        setGallery((prev) => [item, ...prev])

        // Poll until done (bounded)
        for (let attempt = 0; attempt < 80; attempt++) {
          await new Promise((r) => setTimeout(r, 2500))
          let poll: Awaited<ReturnType<typeof studioPollVideo>>
          try {
            poll = await studioPollVideo(taskId)
          } catch {
            continue
          }
          const status = poll.output?.task_status
          if (status === 'SUCCEEDED') {
            setGallery((prev) =>
              prev.map((g) =>
                g.id === item.id
                  ? { ...g, status: 'done', videoUrl: poll.output.video_url || null, latencyMs: Date.now() - started }
                  : g,
              ),
            )
            return
          }
          if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
            setGallery((prev) =>
              prev.map((g) => (g.id === item.id ? { ...g, status: 'failed', error: poll.output?.message || status } : g)),
            )
            return
          }
        }
        setGallery((prev) => prev.map((g) => (g.id === item.id ? { ...g, status: 'failed', error: 'timed out waiting for task' } : g)))
      }
    } catch (err: any) {
      setError(err.message || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }, [generating, prompt, negative, mode, imageModel, videoModel, count, size, videoSize])

  // ⌘/Ctrl+Enter to generate
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void generate()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [generate])

  function reuse(item: GalleryItem) {
    // Rebuild blocks from the stored prompt string (single custom block) + negative
    setBlocks([{ id: uid(), category: 'subject', text: item.prompt, enabled: true }])
    setNegative(item.negative)
    setMode(item.kind)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const activeModel = mode === 'image' ? imageModel : videoModel

  return (
    <AppShell title="Studio">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Studio</h2>
          <p className="text-sm text-muted-foreground">
            Prompt canvas for the media trials — drag blocks, watch the compiled prompt, burn free quota.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border bg-background p-1">
          {(['image', 'video'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                mode === m ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'image' ? '🖼 Image' : '🎬 Video'}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* PALETTE */}
        <Card className="order-2 xl:order-1 h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Block palette</CardTitle>
            <CardDescription className="text-xs">Click to add to the canvas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {CATEGORIES.map((cat) => (
              <div key={cat.id}>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat.label}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {LIBRARY[cat.id].slice(0, 6).map((chip) => (
                    <button
                      key={chip}
                      onClick={() => addBlock(cat.id, chip)}
                      className="max-w-full truncate rounded-md border bg-background px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
                      title={chip}
                    >
                      {chip.length > 26 ? chip.slice(0, 26) + '…' : chip}
                    </button>
                  ))}
                  <button
                    onClick={() => addBlock(cat.id, '')}
                    className="rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    + blank
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* CANVAS */}
        <Card className="order-1 xl:order-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-sm">Prompt canvas</CardTitle>
              <CardDescription className="text-xs">Drag to reorder · click eye to toggle · edits compile live</CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) applyTemplate(e.target.value)
                  e.target.value = ''
                }}
              >
                <option value="">Templates…</option>
                {TEMPLATES.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={surprise}>
                🎲 Surprise me
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void enhancePrompt()}
                disabled={enhancing || !prompt.trim() || chatGroups.length === 0}
                title={chatGroups.length === 0 ? 'Needs a chat-capable group' : `Expand via ${chatGroups[0].id}`}
              >
                {enhancing ? '✨ Enhancing…' : '✨ Enhance'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-destructive hover:text-destructive"
                onClick={() => setBlocks([])}
              >
                Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="min-h-[180px] rounded-lg border bg-background p-2"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(24,24,27,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(24,24,27,0.05) 1px, transparent 1px)',
                backgroundSize: '22px 22px',
              }}
              onDragOver={(e) => e.preventDefault()}
            >
              {blocks.length === 0 ? (
                <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                  Empty canvas — add blocks from the palette or load a template
                </div>
              ) : (
                <div className="space-y-1.5">
                  {blocks.map((block, index) => {
                    const cat = CATEGORY_MAP.get(block.category)!
                    return (
                      <div
                        key={block.id}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragEnter={() => handleDragEnter(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnd={() => (dragIndex.current = null)}
                        className={`group flex items-center gap-2 rounded-md border border-l-4 bg-background px-2 py-1.5 transition-opacity ${
                          block.enabled ? '' : 'opacity-40'
                        }`}
                        style={{ borderLeftColor: cat.color }}
                      >
                        <span className="cursor-grab select-none text-xs text-muted-foreground active:cursor-grabbing" title="Drag to reorder">
                          ⋮⋮
                        </span>
                        <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider" style={{ color: cat.color }}>
                          {cat.label}
                        </span>
                        <input
                          value={block.text}
                          placeholder="describe…"
                          onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                        />
                        <button
                          onClick={() => updateBlock(block.id, { enabled: !block.enabled })}
                          className="shrink-0 rounded px-1 text-xs text-muted-foreground hover:text-foreground"
                          title={block.enabled ? 'Mute block' : 'Enable block'}
                        >
                          {block.enabled ? '👁' : '🚫'}
                        </button>
                        <button
                          onClick={() => removeBlock(block.id)}
                          className="shrink-0 rounded px-1 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Compiled prompt</span>
                  <span>
                    {prompt.length} chars · ~{Math.ceil(prompt.length / 4)} tokens
                  </span>
                </div>
                <p className="min-h-[20px] text-sm leading-snug">
                  {blocks.filter((b) => b.enabled && b.text.trim()).length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    blocks
                      .filter((b) => b.enabled && b.text.trim())
                      .map((b, i, arr) => (
                        <span key={b.id}>
                          <span style={{ color: CATEGORY_MAP.get(b.category)!.color }}>{b.text.trim()}</span>
                          {i < arr.length - 1 && <span className="text-muted-foreground">, </span>}
                        </span>
                      ))
                  )}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <input
                  value={negative}
                  onChange={(e) => setNegative(e.target.value)}
                  placeholder="negative prompt (what to avoid)…"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-56"
                />
              </div>
            </div>

            {/* params + generate */}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {mode === 'image' ? (
                <>
                  <select
                    value={imageModel}
                    onChange={(e) => setImageModel(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {imageGroups.length === 0 && <option value="">no image groups</option>}
                    {imageGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.id}
                      </option>
                    ))}
                  </select>
                  <select
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="1024x1024">1024×1024</option>
                    <option value="1280x720">1280×720</option>
                    <option value="720x1280">720×1280</option>
                  </select>
                  <select
                    value={count}
                    onChange={(e) => setCount(parseInt(e.target.value, 10))}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        ×{n}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <select
                    value={videoModel}
                    onChange={(e) => setVideoModel(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {videoGroups.length === 0 && <option value="">no video groups</option>}
                    {videoGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.id}
                      </option>
                    ))}
                  </select>
                  <select
                    value={videoSize}
                    onChange={(e) => setVideoSize(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="1280*720">1280×720</option>
                    <option value="960*960">960×960</option>
                    <option value="720*1280">720×1280</option>
                  </select>
                </>
              )}
              <div className="ml-auto flex items-center gap-2">
                {activeModel && (
                  <Badge variant="outline" className="hidden font-mono text-[10px] sm:inline-flex">
                    trial-metered
                  </Badge>
                )}
                <Button onClick={() => void generate()} disabled={generating || !prompt.trim() || !activeModel}>
                  {generating ? 'Generating…' : mode === 'image' ? 'Generate image' : 'Submit video task'}
                  <span className="ml-2 hidden text-[10px] opacity-60 sm:inline">⌘⏎</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RESULTS */}
        <Card className="order-3 h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Results</CardTitle>
            <CardDescription className="text-xs">
              {gallery.length} item{gallery.length === 1 ? '' : 's'} · stored locally · click to enlarge
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[70vh] space-y-3 overflow-y-auto">
            {gallery.length === 0 && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nothing yet. Compose a prompt and hit generate.
              </div>
            )}
            {gallery.map((item) => (
              <div key={item.id} className="rounded-lg border p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <Badge
                    variant={item.status === 'done' ? 'default' : item.status === 'pending' ? 'secondary' : 'destructive'}
                    className="text-[10px]"
                  >
                    {item.kind} · {item.status}
                  </Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {item.model} · {item.latencyMs ? `${(item.latencyMs / 1000).toFixed(1)}s` : '…'}
                  </span>
                </div>

                {item.kind === 'image' && item.images && (
                  <div className={`grid gap-1.5 ${item.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {item.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt={`result ${i + 1}`}
                        className="w-full cursor-zoom-in rounded-md border bg-muted/40 object-cover"
                        onClick={() => setLightbox(src)}
                      />
                    ))}
                  </div>
                )}

                {item.kind === 'video' && (
                  <div className="rounded-md border bg-muted/30 p-2">
                    {item.status === 'pending' && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                        rendering task {item.taskId?.slice(0, 14)}…
                      </div>
                    )}
                    {item.status === 'failed' && <p className="text-xs text-destructive">{item.error}</p>}
                    {item.status === 'done' && item.videoUrl && !isMockUrl(item.videoUrl) && (
                      <video src={item.videoUrl} controls className="w-full rounded" />
                    )}
                    {item.status === 'done' && item.videoUrl && isMockUrl(item.videoUrl) && (
                      <p className="font-mono text-[11px] text-muted-foreground">
                        🎬 mock result (Echo): {item.videoUrl}
                      </p>
                    )}
                    {item.status === 'done' && !item.videoUrl && (
                      <p className="text-xs text-muted-foreground">completed (no URL returned)</p>
                    )}
                  </div>
                )}

                <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground" title={item.prompt}>
                  {item.prompt}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                  <button className="font-medium underline underline-offset-2" onClick={() => reuse(item)}>
                    Reuse prompt
                  </button>
                  {item.images?.map((src, i) =>
                    src.startsWith('data:') ? (
                      <a key={i} href={src} download={`aliproxy-${item.id}-${i + 1}.png`} className="underline underline-offset-2">
                        Download {i + 1}
                      </a>
                    ) : null,
                  )}
                  {item.videoUrl && !isMockUrl(item.videoUrl) && (
                    <a href={item.videoUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      Open video ↗
                    </a>
                  )}
                  <button
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => setGallery((prev) => prev.filter((g) => g.id !== item.id))}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="sm:max-w-[768px]">
          <DialogHeader>
            <DialogTitle>Result</DialogTitle>
            <DialogDescription>Saved locally in your browser</DialogDescription>
          </DialogHeader>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lightbox} alt="enlarged result" className="max-h-[70vh] w-full rounded-lg object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
