/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Single-origin deployment: the dashboard proxies /api/* to the local
  // Aliproxy server, so browsers (and remote previews) never need to reach
  // 127.0.0.1:8080 directly. Override for split deployments with
  // NEXT_PUBLIC_PROXY_API_URL + a proxy target env if needed.
  async rewrites() {
    const target = process.env.ALIPROXY_API_TARGET || 'http://127.0.0.1:8080'
    return [
      {
        source: '/api/:path*',
        destination: `${target}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
