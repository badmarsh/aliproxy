import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Aliproxy 2026 · Ultimate Proxy Suite',
  description: 'Aliproxy 2026 Ultimate Proxy Suite — manage DashScope/Qwen API keys, model groups, routing, and metrics',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}