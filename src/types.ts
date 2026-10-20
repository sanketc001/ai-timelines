export interface Connection {
  targetId: string
  relation: string
}

export interface Resource {
  id: string
  title: string
  date?: string
  url?: string
  type: 'paper' | 'model' | 'event' | 'article' | 'dataset' | 'org' | 'other'
  summary: string
  tags: string[]
  connections: Connection[]
  source: 'chat' | 'manual'
  addedAt: string
}

export interface KnowledgeBase {
  resources: Resource[]
}

export type ToolActivity =
  | { kind: 'search'; query: string; done: boolean }
  | { kind: 'browse'; url: string; done: boolean }
  | { kind: 'add_resources'; count: number }
  | { kind: 'checkpoint'; summary: string; totalAdded: number }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool-activity'
  content: string
  activity?: ToolActivity
  timestamp: number
}
