'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select'

// Mock data for model groups
const initialModelGroups = [
  {
    id: 'qwen-max',
    display_name: 'Qwen Max',
    aliases: ['gpt-4o', 'claude-opus-4'],
    upstream_models: ['qwen-max', 'qwen-max-longcontext'],
    key_ids: ['1', '2'],
    strategy: 'least-quota',
    weights: {},
    fallback_group: 'qwen-plus',
    enabled: true,
    created_at: '2026-09-01T14:30:00Z',
  },
  {
    id: 'qwen-coder',
    display_name: 'Qwen Coder',
    aliases: ['gpt-4-turbo'],
    upstream_models: ['qwen2.5-coder-32b-instruct'],
    key_ids: ['2'],
    strategy: 'round-robin',
    weights: {},
    fallback_group: null,
    enabled: true,
    created_at: '2026-09-01T14:30:00Z',
  },
  {
    id: 'qwen-plus',
    display_name: 'Qwen Plus',
    aliases: ['gpt-4o-mini'],
    upstream_models: ['qwen-plus', 'qwen-plus-latest'],
    key_ids: ['1', '3'],
    strategy: 'first-available',
    weights: {},
    fallback_group: 'qwen-turbo',
    enabled: true,
    created_at: '2026-09-01T14:30:00Z',
  },
]

export default function ModelGroupsPage() {
  const [modelGroups, setModelGroups] = useState(initialModelGroups)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<any>(null)
  const [formData, setFormData] = useState({
    id: '',
    display_name: '',
    aliases: [] as string[],
    upstream_models: [] as string[],
    strategy: 'round-robin',
    fallback_group: '',
  })

  const handleCreateGroup = () => {
    setEditingGroup(null)
    setFormData({
      id: '',
      display_name: '',
      aliases: [],
      upstream_models: [],
      strategy: 'round-robin',
      fallback_group: '',
    })
    setIsDialogOpen(true)
  }

  const handleEditGroup = (group: any) => {
    setEditingGroup(group)
    setFormData({
      id: group.id,
      display_name: group.display_name,
      aliases: [...group.aliases],
      upstream_models: [...group.upstream_models],
      strategy: group.strategy,
      fallback_group: group.fallback_group || '',
    })
    setIsDialogOpen(true)
  }

  const handleSaveGroup = () => {
    if (editingGroup) {
      // Update existing group
      setModelGroups(modelGroups.map(group => 
        group.id === editingGroup.id 
          ? { 
              ...group, 
              ...formData,
              fallback_group: formData.fallback_group || null
            } 
          : group
      ))
    } else {
      // Create new group
      const newGroup = {
        ...formData,
        key_ids: [],
        weights: {},
        fallback_group: formData.fallback_group || null,
        enabled: true,
        created_at: new Date().toISOString(),
      }
      setModelGroups([...modelGroups, newGroup])
    }
    
    setIsDialogOpen(false)
    setEditingGroup(null)
  }

  const handleToggleStatus = (id: string) => {
    setModelGroups(modelGroups.map(group => 
      group.id === id 
        ? { ...group, enabled: !group.enabled } 
        : group
    ))
  }

  const handleDeleteGroup = (id: string) => {
    setModelGroups(modelGroups.filter(group => group.id !== id))
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/40">
      <div className="flex flex-col sm:gap-4 sm:py-4">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Model Groups Management</h1>
          </div>
        </header>
        
        <main className="grid flex-1 items-start gap-4 p-4 sm:px-6 sm:py-0 md:gap-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Model Groups</h2>
              <p className="text-muted-foreground">
                Configure model routing groups
              </p>
            </div>
            <Button onClick={handleCreateGroup}>Create Group</Button>
          </div>
          
          <Card>
            <CardHeader>
              <CardTitle>Model Groups</CardTitle>
              <CardDescription>
                Define how incoming model requests are routed to upstream models
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Aliases</TableHead>
                    <TableHead>Models</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Fallback</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelGroups.map((group) => (
                    <TableRow key={group.id}>
                      <TableCell className="font-medium">{group.id}</TableCell>
                      <TableCell>{group.display_name}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {group.aliases.map((alias) => (
                            <Badge key={alias} variant="secondary">
                              {alias}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {group.upstream_models.map((model) => (
                            <Badge key={model} variant="outline">
                              {model}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">
                          {group.strategy}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {group.fallback_group ? (
                          <Badge variant="secondary">
                            {group.fallback_group}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={group.enabled ? 'default' : 'destructive'}>
                          {group.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleEditGroup(group)}
                          >
                            Edit
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleToggleStatus(group.id)}
                          >
                            {group.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleDeleteGroup(group.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </main>
      </div>
      
      {/* Dialog for creating/editing model groups */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingGroup ? 'Edit Model Group' : 'Create Model Group'}</DialogTitle>
            <DialogDescription>
              {editingGroup 
                ? 'Modify the model group details below.' 
                : 'Enter the details for your new model group.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="id" className="text-right">
                ID
              </Label>
              <Input
                id="id"
                value={formData.id}
                onChange={(e) => setFormData({...formData, id: e.target.value})}
                className="col-span-3"
                disabled={!!editingGroup}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="display_name" className="text-right">
                Name
              </Label>
              <Input
                id="display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({...formData, display_name: e.target.value})}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="aliases" className="text-right">
                Aliases
              </Label>
              <Input
                id="aliases"
                placeholder="Comma separated aliases"
                value={formData.aliases.join(', ')}
                onChange={(e) => setFormData({...formData, aliases: e.target.value.split(',').map(a => a.trim())})}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="upstream_models" className="text-right">
                Models
              </Label>
              <Input
                id="upstream_models"
                placeholder="Comma separated model IDs"
                value={formData.upstream_models.join(', ')}
                onChange={(e) => setFormData({...formData, upstream_models: e.target.value.split(',').map(m => m.trim())})}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="strategy" className="text-right">
                Strategy
              </Label>
              <Select 
                value={formData.strategy} 
                onValueChange={(value) => setFormData({...formData, strategy: value})}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round-robin">Round Robin</SelectItem>
                  <SelectItem value="least-quota">Least Quota</SelectItem>
                  <SelectItem value="weighted">Weighted</SelectItem>
                  <SelectItem value="first-available">First Available</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="fallback_group" className="text-right">
                Fallback
              </Label>
              <Input
                id="fallback_group"
                placeholder="Fallback group ID (optional)"
                value={formData.fallback_group}
                onChange={(e) => setFormData({...formData, fallback_group: e.target.value})}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveGroup}>
              {editingGroup ? 'Update Group' : 'Create Group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}