import { search, SafeSearchType } from 'duck-duck-scrape'
import { randomBytes } from 'crypto'

export interface SearchResult {
  title: string
  url: string
  description: string
}

// Stable per-process session ID for Parallel AI free-tier rate limiting
const PARALLEL_SESSION_ID = randomBytes(16).toString('hex')

async function searchParallelAI(query: string, maxResults: number): Promise<SearchResult[]> {
  const res = await fetch('https://search.parallel.ai/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'web_search',
        arguments: {
          objective: query,
          search_queries: [query],
          session_id: PARALLEL_SESSION_ID,
          model_name: 'claude-sonnet-4-6',
        },
      },
      id: Date.now(),
    }),
  })

  if (!res.ok) throw new Error(`Parallel AI HTTP ${res.status}`)

  const data = (await res.json()) as {
    result?: { content?: Array<{ type: string; text: string }> }
    error?: { message: string }
  }

  if (data.error) throw new Error(data.error.message)

  const text = data.result?.content?.find((c) => c.type === 'text')?.text
  if (!text) return []

  const parsed = JSON.parse(text) as {
    results?: Array<{ url: string; title: string; excerpts?: string[] }>
  }

  return (parsed.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    description: (r.excerpts?.[0] ?? '').slice(0, 300),
  }))
}

export async function searchWeb(query: string, maxResults = 8): Promise<SearchResult[]> {
  // Try DuckDuckGo first
  try {
    const { results } = await search(query, { safeSearch: SafeSearchType.OFF })
    if (results.length > 0) {
      return results.slice(0, maxResults).map((r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        description: (r.description ?? '').slice(0, 300),
      }))
    }
  } catch (err) {
    console.warn('[search] DuckDuckGo failed, falling back to Parallel AI:', (err as Error).message)
  }

  // Fallback to Parallel AI
  try {
    const results = await searchParallelAI(query, maxResults)
    console.log(`[search] Parallel AI returned ${results.length} results`)
    return results
  } catch (err) {
    console.error('[search] Parallel AI also failed:', err)
    return []
  }
}
