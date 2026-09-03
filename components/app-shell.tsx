'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/groups', label: 'Groups' },
  { href: '/studio', label: 'Studio' },
  { href: '/quota-radar', label: 'Quota Radar' },
  { href: '/client-keys', label: 'Client Keys' },
  { href: '/usage', label: 'Usage & Savings' },
  { href: '/playground', label: 'Playground' },
  { href: '/metrics', label: 'Metrics' },
  { href: '/api-docs', label: 'API Docs' },
  { href: '/settings', label: 'Settings' },
]

export function AppShell({
  title,
  children,
  right,
}: {
  title?: string
  children: ReactNode
  right?: ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <div className="flex flex-col sm:gap-4 sm:py-4">
        <header className="hud-header sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <span className="hud-logo flex h-8 w-8 items-center justify-center rounded-lg bg-foreground font-mono text-sm font-bold text-background">
                α
              </span>
              <span className="hidden sm:block">
                <span className="block text-lg font-bold leading-tight tracking-tight">Aliproxy 2026</span>
                <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Ultimate Proxy Suite · Trial Farm
                </span>
              </span>
            </Link>
            {title && (
              <span className="hidden md:inline truncate text-sm text-muted-foreground">· {title}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">{right}</div>
        </header>

        <nav className="flex items-center gap-1 overflow-x-auto px-4 sm:px-6 pb-1" aria-label="Main navigation">
          {NAV.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'hud-nav-active bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">{children}</main>
      </div>
    </div>
  )
}
