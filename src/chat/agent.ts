import type { KnowledgeBase, Resource, ToolActivity } from '../types'

export type OnActivity = (activity: ToolActivity) => void

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web. For systematic tasks, issue one targeted search per item (e.g. one per year, one per conference).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query, 3-8 words' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_page',
      description: 'Load a web page and extract its text content and links. Use to get full paper lists from official conference pages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to browse' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_resources',
      description: 'Add or update resources in the knowledge base. Call this after researching each item in a systematic task — do not batch all years together. For connections: only add them when there is a direct semantic relationship (built on, cites, preceded, led to). Never connect resources simply because they share tags or the same venue.',
      parameters: {
        type: 'object',
        properties: {
          resources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'URL-friendly slug, e.g. cvpr-2023-best-paper' },
                title: { type: 'string' },
                date: { type: 'string', description: 'ISO date e.g. 2023-06-12' },
                url: { type: 'string' },
                type: { type: 'string', enum: ['paper', 'model', 'event', 'article', 'dataset', 'org', 'other'] },
                summary: { type: 'string', description: 'One to two sentence summary' },
                tags: { type: 'array', items: { type: 'string' } },
                connections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      targetId: { type: 'string' },
                      relation: { type: 'string', description: 'e.g. "led to", "built on", "preceded", "related to"' },
                    },
                    required: ['targetId', 'relation'],
                  },
                },
              },
              required: ['id', 'title', 'type', 'summary'],
            },
          },
        },
        required: ['resources'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'signal_done',
      description: 'Signal that the task is fully complete. Only call this when EVERY item in the requested range has been searched and added. Include a summary of what was added.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Brief summary of everything added' },
          total_added: { type: 'number', description: 'Total resources added this session' },
        },
        required: ['summary'],
      },
    },
  },
]

// Rough token estimate: chars / 4
function estimateTokens(msgs: OpenAIMessage[]): number {
  return msgs.reduce((s, m) => s + JSON.stringify(m).length / 4, 0)
}

// Remove oldest complete tool-call rounds (assistant msg + all its tool results)
// until estimated tokens fall below the target. Always keeps system + first user.
function pruneOldRounds(messages: OpenAIMessage[], targetTokens = 80_000): OpenAIMessage[] {
  if (estimateTokens(messages) <= targetTokens) return messages

  const system = messages[0]
  const firstUser = messages[1]
  const rest = messages.slice(2)

  // Group rest into rounds: each round starts with an assistant message
  const rounds: OpenAIMessage[][] = []
  let cur: OpenAIMessage[] = []
  for (const msg of rest) {
    if (msg.role === 'assistant' && cur.length > 0) {
      rounds.push(cur)
      cur = [msg]
    } else {
      cur.push(msg)
    }
  }
  if (cur.length > 0) rounds.push(cur)

  // Drop oldest rounds (but always keep the last round)
  while (rounds.length > 1 && estimateTokens([system, firstUser, ...rounds.flat()]) > targetTokens) {
    rounds.shift()
  }

  return [system, firstUser, ...rounds.flat()]
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AgentSignal {
  cancelled: boolean
}

function selfResearchAddendum(userMessage: string) {
  return `
## SELF-RESEARCH MODE (ACTIVE — NO STOP CONDITION)
You are running in fully autonomous mode with no iteration cap.
- STAY ON TOPIC: every search and every resource you add must be directly related to the user's original request: "${userMessage}". Do NOT drift to tangentially related or unrelated subjects.
- After completing a subtask, continue with the next most important aspect of the SAME topic
- Never wait for user confirmation between subtasks — keep researching
- signal_done is a PROGRESS CHECKPOINT, not a stop signal. After calling it you MUST continue.
- After each signal_done, identify the next 3-5 most valuable unexplored aspects of "${userMessage}" and start on the first one
- Follow connections WITHIN the topic: when you add a paper, research what it built on and what it led to — but only if those are also about "${userMessage}"
- Keep expanding until the user explicitly stops you with the stop button`
}

export async function runAgent(
  userMessage: string,
  kb: KnowledgeBase,
  onActivity: OnActivity,
  onPartialAssistant: (text: string) => void,
  signal?: AgentSignal,
  selfResearch = false,
): Promise<string> {
  const kbSummary = kb.resources.length === 0
    ? 'Empty.'
    : kb.resources.map((r) => `${r.id} | ${r.title} | ${r.date ?? 'no date'}`).join('\n')

  const systemPrompt = `You are an exhaustive AI research assistant. You build comprehensive, well-connected knowledge bases about AI history, papers, models, and events.

## SYSTEMATIC TASK RULES (CRITICAL — follow these exactly)

When asked to cover a range (years, conferences, topics, categories):

1. **Plan first**: In your first reply, briefly list every item you will cover (e.g. "I will add CVPR papers for 2020, 2021, 2022, 2023, 2024, 2025 — processing each year separately").
2. **One item at a time**: search → browse the most relevant result → add_resources → move to the next item. Do NOT batch multiple years into one search.
3. **For each conference year**: search "[conference] [year] best papers" and "[conference] [year] accepted papers list", browse the official page or a reliable summary, then add 5-15 notable papers with proper dates, URLs, and connections.
4. **Connect resources — STRICT RULES**:
   - ONLY add a connection when there is a direct semantic relationship between two specific resources: X directly built on Y, X cites Y as foundational, X is the successor of Y, X introduced the concept Y later used.
   - NEVER connect two resources just because they share tags, are from the same conference, or are in the same field. Shared context is NOT a connection.
   - Maximum 3 connections per resource, and only the most direct/important ones.
   - Good example: targetId "attention-is-all-you-need" relation "built on" for BERT. Bad: connecting every CVPR 2023 paper to every other CVPR 2023 paper with "related to" or "same venue".
5. **Never stop mid-task**: after adding one year's resources, immediately start the next year WITHOUT asking for confirmation. Keep going until ALL years/items are done.
6. **Only call signal_done when EVERY item in the requested range is complete**. If asked for 2020-2025, you must complete all 6 years before calling signal_done.

## General rules
- Prefer official conference pages, arxiv, papers with code, and Wikipedia for sources
- Always include the date (use conference date, not paper submission date)
- Always include the URL
- Add meaningful connections between related resources
- If a search returns poor results, try browsing a known URL directly (e.g. cvpr.thecvf.com)

## Current knowledge base (${kb.resources.length} resources)
${kbSummary}${selfResearch ? selfResearchAddendum(userMessage) : ''}`

  const messages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  let iterations = 0
  const MAX_ITER = selfResearch ? Number.MAX_SAFE_INTEGER : 60
  let totalAdded = 0
  let finalSummary = ''

  // Loop-detection state
  const searchedQueries = new Set<string>()
  const browsedUrls = new Set<string>()
  let staleIters = 0   // iterations with zero new tool-call progress
  const MAX_STALE = 4  // nudge after this many consecutive stale iterations

  while (iterations < MAX_ITER) {
    if (signal?.cancelled) {
      return finalSummary || `Stopped after ${iterations} steps. ${totalAdded} resources added.`
    }

    iterations++
    let madeProgress = false  // did any tool call do something new this iteration?

    const trimmed = pruneOldRounds(messages)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: trimmed,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 2048,
        temperature: 0.2,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Azure OpenAI error ${res.status}: ${errText}`)
    }

    const data = (await res.json()) as {
      choices: Array<{
        finish_reason: string
        message: {
          role: string
          content: string | null
          tool_calls?: ToolCall[]
        }
      }>
    }

    const choice = data.choices[0]
    if (!choice) throw new Error('No choice returned from API')

    const assistantMsg = choice.message

    messages.push({
      role: 'assistant',
      content: assistantMsg.content,
      tool_calls: assistantMsg.tool_calls,
    })

    if (assistantMsg.content) {
      finalSummary = assistantMsg.content
      onPartialAssistant(assistantMsg.content)
    }

    // In self-research mode a natural stop means the model lost the thread — nudge it
    if (choice.finish_reason === 'stop' && !assistantMsg.tool_calls?.length) {
      if (!selfResearch) return assistantMsg.content ?? finalSummary
      messages.push({
        role: 'user',
        content: `The KB now has ${kb.resources.length + totalAdded} resources. Stay focused on the original topic: "${userMessage}". What are the most important related aspects not yet covered? Continue researching those now.`,
      })
      continue
    }

    if (!assistantMsg.tool_calls?.length) break

    // Execute tool calls
    for (const tc of assistantMsg.tool_calls) {
      if (signal?.cancelled) break

      const args = JSON.parse(tc.function.arguments) as Record<string, unknown>
      let toolResult = ''
      let skipPush = false

      if (tc.function.name === 'search_web') {
        const query = args.query as string
        const key = query.toLowerCase().trim()
        if (searchedQueries.has(key)) {
          toolResult = JSON.stringify({ duplicate: true, message: `Already searched "${query}" this session. Use a different query or move to the next topic.` })
        } else {
          searchedQueries.add(key)
          madeProgress = true
          onActivity({ kind: 'search', query, done: false })
          const results = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          }).then((r) => r.json())
          onActivity({ kind: 'search', query, done: true })
          toolResult = JSON.stringify(results)
        }

      } else if (tc.function.name === 'browse_page') {
        const url = args.url as string
        if (browsedUrls.has(url)) {
          toolResult = JSON.stringify({ duplicate: true, message: `Already browsed ${url} this session. Use information already gathered or browse a different page.` })
        } else {
          browsedUrls.add(url)
          madeProgress = true
          onActivity({ kind: 'browse', url, done: false })
          const result = await fetch('/api/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          }).then((r) => r.json())
          onActivity({ kind: 'browse', url, done: true })
          toolResult = JSON.stringify(result)
        }

      } else if (tc.function.name === 'add_resources') {
        const resources = (args.resources as Resource[]).map((r) => ({
          ...r,
          source: 'chat' as const,
          addedAt: new Date().toISOString(),
          tags: r.tags ?? [],
          connections: r.connections ?? [],
        }))
        const updated = await fetch('/api/kb/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resources),
        }).then((r) => r.json())
        totalAdded += resources.length
        madeProgress = true
        staleIters = 0  // adding resources resets the stale counter regardless of other calls
        onActivity({ kind: 'add_resources', count: resources.length })
        toolResult = JSON.stringify({ ok: true, total: (updated as KnowledgeBase).resources.length })

      } else if (tc.function.name === 'signal_done') {
        const { summary } = args as { summary: string }
        if (selfResearch) {
          // Checkpoint — surface progress and keep going
          onActivity({ kind: 'checkpoint', summary, totalAdded })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Checkpoint recorded. Continue researching.', name: tc.function.name })
          messages.push({
            role: 'user',
            content: `Good progress (${totalAdded} resources added this session). Stay on topic: "${userMessage}". What are the most important aspects of this topic still not covered in the KB? Continue researching those now.`,
          })
          skipPush = true
        } else {
          finalSummary = summary
          onPartialAssistant(summary)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Done.', name: tc.function.name })
          return summary
        }
      }

      if (!skipPush) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResult,
          name: tc.function.name,
        })
      }
    }

    // Stale-loop detection: if no new searches/browses/adds this iteration, count it
    if (!madeProgress) {
      staleIters++
      if (staleIters >= MAX_STALE) {
        staleIters = 0
        const alreadySeen = [
          ...[...searchedQueries].map((q) => `searched: "${q}"`),
          ...[...browsedUrls].map((u) => `browsed: ${u}`),
        ].slice(-10).join(', ')
        messages.push({
          role: 'user',
          content: `You appear to be stuck — no new resources added in ${MAX_STALE} iterations. Already done this session: ${alreadySeen || 'nothing yet'}. Stop repeating. Pick a completely different aspect of "${userMessage}" that hasn't been covered and research that now.`,
        })
      }
    } else {
      staleIters = 0
    }
  }

  return finalSummary || `Stopped after ${iterations} steps. ${totalAdded} resources added.`
}
