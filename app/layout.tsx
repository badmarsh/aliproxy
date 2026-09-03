import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Qwen Proxy Dashboard',
  description: 'Manage your Qwen API keys and model routing',
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