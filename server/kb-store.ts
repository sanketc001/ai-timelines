import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const KB_PATH = resolve(process.cwd(), 'data', 'knowledge-base.json')

export interface Resource {
  id: string
  title: string
  date?: string
  url?: string
  type: 'paper' | 'model' | 'event' | 'article' | 'dataset' | 'org' | 'other'
  summary: string
  tags: string[]
  connections: { targetId: string; relation: string }[]
  source: 'chat' | 'manual'
  addedAt: string
}

export interface KnowledgeBase {
  resources: Resource[]
}

export function readKB(): KnowledgeBase {
  try {
    return JSON.parse(readFileSync(KB_PATH, 'utf-8')) as KnowledgeBase
  } catch {
    return { resources: [] }
  }
}

export function upsertResources(incoming: Resource[]): KnowledgeBase {
  const kb = readKB()
  const byId = new Map(kb.resources.map((r) => [r.id, r]))
  const byUrl = new Map(kb.resources.filter((r) => r.url).map((r) => [r.url!, r]))

  for (const res of incoming) {
    const existing = byId.get(res.id) ?? (res.url ? byUrl.get(res.url) : undefined)
    if (existing) {
      // merge — don't overwrite manual entries with chat ones
      const merged: Resource = {
        ...existing,
        ...res,
        id: existing.id,
        connections: mergeConnections(existing.connections, res.connections),
        tags: Array.from(new Set([...existing.tags, ...res.tags])),
        addedAt: existing.addedAt,
      }
      byId.set(merged.id, merged)
      if (merged.url) byUrl.set(merged.url, merged)
    } else {
      byId.set(res.id, res)
      if (res.url) byUrl.set(res.url, res)
    }
  }

  kb.resources = Array.from(byId.values())
  writeFileSync(KB_PATH, JSON.stringify(kb, null, 2), 'utf-8')
  return kb
}

function mergeConnections(
  a: Resource['connections'],
  b: Resource['connections'],
): Resource['connections'] {
  const seen = new Set(a.map((c) => `${c.targetId}:${c.relation}`))
  return [...a, ...b.filter((c) => !seen.has(`${c.targetId}:${c.relation}`))]
}
