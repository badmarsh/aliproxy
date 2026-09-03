'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'

export default function SettingsPage() {
  const [proxyRunning, setProxyRunning] = useState(true)
  const [darkMode, setDarkMode] = useState(true)
  const [selectedTheme, setSelectedTheme] = useState('vercel')
  const [config, setConfig] = useState({
    port: '8080',
    host: '127.0.0.1',
    proxy_api_key: 'sk-proxy-xxxxxxxxxxxxx',
    quota_refresh_interval_seconds: '300',
    quota_warning_threshold: '20',
  })

  const handleToggleProxy = () => {
    setProxyRunning(!proxyRunning)
  }

  const handleSaveConfig = () => {
    // In a real implementation, this would save to the backend
    console.log('Saving config:', config)
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <div className="flex flex-col sm:gap-4 sm:py-4">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Settings</h1>
          </div>
        </header>
        
        <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
            <p className="text-muted-foreground">
              Configure the proxy server and dashboard preferences
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2">
            {/* Proxy Configuration */}
            <Card>
              <CardHeader>
                <CardTitle>Proxy Configuration</CardTitle>
                <CardDescription>
                  Configure the local proxy server settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Server status */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Server Status</p>
                      <p className="text-sm text-muted-foreground">
                        {proxyRunning 
                          ? `Running on port ${config.port}` 
                          : 'Server is stopped'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={proxyRunning ? 'default' : 'secondary'}>
                        {proxyRunning ? 'Running' : 'Stopped'}
                      </Badge>
                      <Button 
                        variant={proxyRunning ? 'outline' : 'default'} 
                        onClick={handleToggleProxy}
                      >
                        {proxyRunning ? 'Stop Server' : 'Start Server'}
                      </Button>
                    </div>
                  </div>
                  
                  {/* Host */}
                  <div className="grid gap-2">
                    <Label htmlFor="host">Host</Label>
                    <Input
                      id="host"
                      value={config.host}
                      onChange={(e) => setConfig({...config, host: e.target.value})}
                      disabled={proxyRunning}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default: 127.0.0.1 (localhost only)
                    </p>
                  </div>
                  
                  {/* Port */}
                  <div className="grid gap-2">
                    <Label htmlFor="port">Port</Label>
                    <Input
                      id="port"
                      type="number"
                      value={config.port}
                      onChange={(e) => setConfig({...config, port: e.target.value})}
                      disabled={proxyRunning}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default: 8080
                    </p>
                  </div>
                  
                  {/* Proxy API Key */}
                  <div className="grid gap-2">
                    <Label htmlFor="proxy_key">Proxy API Key</Label>
                    <Input
                      id="proxy_key"
                      type="password"
                      value={config.proxy_api_key}
                      onChange={(e) => setConfig({...config, proxy_api_key: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                      Clients use this key to authenticate with the proxy
                    </p>
                  </div>
                  
                  {/* Quota Refresh Interval */}
                  <div className="grid gap-2">
                    <Label htmlFor="quota_interval">Quota Refresh Interval (seconds)</Label>
                    <Input
                      id="quota_interval"
                      type="number"
                      value={config.quota_refresh_interval_seconds}
                      onChange={(e) => setConfig({...config, quota_refresh_interval_seconds: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default: 300 seconds (5 minutes)
                    </p>
                  </div>
                  
                  {/* Quota Warning Threshold */}
                  <div className="grid gap-2">
                    <Label htmlFor="quota_threshold">Quota Warning Threshold (%)</Label>
                    <Input
                      id="quota_threshold"
                      type="number"
                      value={config.quota_warning_threshold}
                      onChange={(e) => setConfig({...config, quota_warning_threshold: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">
                      Warn when quota drops below this percentage (default: 20%)
                    </p>
                  </div>
                  
                  <Button onClick={handleSaveConfig} className="w-full">
                    Save Configuration
                  </Button>
                </div>
              </CardContent>
            </Card>
            
            {/* Appearance */}
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Customize the dashboard appearance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Dark mode */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Dark Mode</p>
                      <p className="text-sm text-muted-foreground">
                        Toggle between light and dark themes
                      </p>
                    </div>
                    <Switch 
                      checked={darkMode} 
                      onCheckedChange={setDarkMode} 
                    />
                  </div>
                  
                  {/* Color theme */}
                  <div>
                    <Label>Color Theme</Label>
                    <div className="mt-2 grid grid-cols-3 gap-3">
                      <button
                        className={`rounded-lg border-2 p-3 text-center transition-colors ${
                          selectedTheme === 'vercel' 
                            ? 'border-primary bg-primary text-primary-foreground' 
                            : 'border-border hover:border-primary'
                        }`}
                        onClick={() => setSelectedTheme('vercel')}
                      >
                        <div className="flex items-center justify-center gap-1 mb-2">
                          <div className="h-4 w-4 rounded-full bg-black border border-border"></div>
                          <div className="h-4 w-4 rounded-full bg-white border border-border"></div>
                        </div>
                        <span className="text-xs font-medium">Vercel</span>
                      </button>
                      
                      <button
                        className={`rounded-lg border-2 p-3 text-center transition-colors ${
                          selectedTheme === 'blue' 
                            ? 'border-primary bg-primary text-primary-foreground' 
                            : 'border-border hover:border-primary'
                        }`}
                        onClick={() => setSelectedTheme('blue')}
                      >
                        <div className="flex items-center justify-center gap-1 mb-2">
                          <div className="h-4 w-4 rounded-full bg-blue-500 border border-border"></div>
                          <div className="h-4 w-4 rounded-full bg-blue-300 border border-border"></div>
                        </div>
                        <span className="text-xs font-medium">Blue</span>
                      </button>
                      
                      <button
                        className={`rounded-lg border-2 p-3 text-center transition-colors ${
                          selectedTheme === 'green' 
                            ? 'border-primary bg-primary text-primary-foreground' 
                            : 'border-border hover:border-primary'
                        }`}
                        onClick={() => setSelectedTheme('green')}
                      >
                        <div className="flex items-center justify-center gap-1 mb-2">
                          <div className="h-4 w-4 rounded-full bg-green-500 border border-border"></div>
                          <div className="h-4 w-4 rounded-full bg-green-300 border border-border"></div>
                        </div>
                        <span className="text-xs font-medium">Green</span>
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Security */}
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>
                Configure security settings for the proxy
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Enable TLS</p>
                    <p className="text-sm text-muted-foreground">
                      Use HTTPS for encrypted communication
                    </p>
                  </div>
                  <Switch />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Log Request Payloads</p>
                    <p className="text-sm text-muted-foreground">
                      Store full request/response payloads (potential security risk)
                    </p>
                  </div>
                  <Switch defaultChecked={false} />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Protect Web UI</p>
                    <p className="text-sm text-muted-foreground">
                      Require a password to access the dashboard
                    </p>
                  </div>
                  <Switch />
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}