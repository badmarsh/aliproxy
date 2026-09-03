'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts'

// Mock data for charts
const requestVolumeData = [
  { hour: '00:00', requests: 25 },
  { hour: '02:00', requests: 18 },
  { hour: '04:00', requests: 12 },
  { hour: '06:00', requests: 30 },
  { hour: '08:00', requests: 65 },
  { hour: '10:00', requests: 95 },
  { hour: '12:00', requests: 120 },
  { hour: '14:00', requests: 110 },
  { hour: '16:00', requests: 88 },
  { hour: '18:00', requests: 72 },
  { hour: '20:00', requests: 55 },
  { hour: '22:00', requests: 40 },
]

const latencyData = [
  { model: 'qwen-max', latency: 420, requests: 450 },
  { model: 'qwen-plus', latency: 310, requests: 890 },
  { model: 'qwen-coder', latency: 520, requests: 320 },
  { model: 'embedding', latency: 180, requests: 250 },
  { model: 'qwen-vl', latency: 650, requests: 120 },
]

const recentLogs = [
  {
    id: '1',
    timestamp: '14:32:15',
    requested_model: 'qwen-max',
    upstream_model: 'qwen-max-longcontext',
    status_code: 200,
    latency_ms: 420,
    prompt_tokens: 128,
    completion_tokens: 342,
  },
  {
    id: '2',
    timestamp: '14:31:58',
    requested_model: 'embedding',
    upstream_model: 'text-embedding-v3',
    status_code: 200,
    latency_ms: 180,
    prompt_tokens: 512,
    completion_tokens: 0,
  },
  {
    id: '3',
    timestamp: '14:31:42',
    requested_model: 'qwen-coder',
    upstream_model: 'qwen2.5-coder-32b-instruct',
    status_code: 429,
    latency_ms: 350,
    prompt_tokens: 256,
    completion_tokens: 187,
  },
  {
    id: '4',
    timestamp: '14:30:55',
    requested_model: 'qwen-plus',
    upstream_model: 'qwen-plus-latest',
    status_code: 200,
    latency_ms: 300,
    prompt_tokens: 96,
    completion_tokens: 234,
  },
  {
    id: '5',
    timestamp: '14:29:12',
    requested_model: 'qwen-vl',
    upstream_model: 'qwen-vl-max',
    status_code: 200,
    latency_ms: 610,
    prompt_tokens: 2048,
    completion_tokens: 415,
  },
]

export default function MetricsPage() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <div className="flex flex-col sm:gap-4 sm:py-4">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Metrics Dashboard</h1>
          </div>
        </header>
        
        <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Requests</CardDescription>
                <CardTitle className="text-4xl">1,248</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  +12% from yesterday
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Requests Last Hour</CardDescription>
                <CardTitle className="text-4xl">87</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  Peak: 120 at 14:00
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Avg Latency</CardDescription>
                <CardTitle className="text-4xl">412ms</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  -5% from yesterday
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Error Rate</CardDescription>
                <CardTitle className="text-4xl">2.3%</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  29 errors in last 24h
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Charts */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Request Volume</CardTitle>
                <CardDescription>
                  Requests per hour over the last 24 hours
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={requestVolumeData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="hour" />
                      <YAxis />
                      <Tooltip />
                      <Line 
                        type="monotone" 
                        dataKey="requests" 
                        stroke="hsl(0, 0%, 9%)" 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Latency by Model</CardTitle>
                <CardDescription>
                  Average response time by model group
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={latencyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="model" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="latency" fill="hsl(0, 0%, 9%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Requests per model */}
          <Card>
            <CardHeader>
              <CardTitle>Top Models</CardTitle>
              <CardDescription>
                Most requested model groups in the last 24 hours
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {latencyData.sort((a, b) => b.requests - a.requests).map((model) => (
                  <div key={model.model}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{model.model}</span>
                      <span className="text-muted-foreground">{model.requests} requests</span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-secondary">
                      <div 
                        className="h-2 rounded-full bg-primary" 
                        style={{ width: `${(model.requests / Math.max(...latencyData.map(m => m.requests))) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {/* Detailed logs */}
          <Card>
            <CardHeader>
              <CardTitle>Live Request Log</CardTitle>
              <CardDescription>
                Recent API requests processed by the proxy
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Requested Model</TableHead>
                    <TableHead>Upstream Model</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Latency</TableHead>
                    <TableHead>Tokens (in/out)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">{log.timestamp}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{log.requested_model}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{log.upstream_model}</TableCell>
                      <TableCell>
                        <Badge variant={log.status_code === 200 ? 'default' : 'destructive'}>
                          {log.status_code}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.latency_ms}ms</TableCell>
                      <TableCell>{log.prompt_tokens} / {log.completion_tokens}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}