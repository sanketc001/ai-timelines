import { useState, useRef, useEffect, useCallback } from 'react'
import { useKB } from '../kb/useKnowledgeBase'
import { runAgent } from '../chat/agent'
import type { AgentSignal } from '../chat/agent'
import type { ChatMessage, ToolActivity } from '../types'

const STORAGE_KEY = 'ai-timelines-chat-history'
const MAX_STORED = 200

function uid() {
  return Math.random().toString(36).slice(2)
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    // Only restore user + assistant messages; drop tool-activity (ephemeral)
    return parsed.filter((m) => m.role === 'user' || m.role === 'assistant')
  } catch {
    return []
  }
}

function saveHistory(messages: ChatMessage[]) {
  try {
    const toSave = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_STORED)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  } catch {
    // quota exceeded — silently ignore
  }
}

function ActivityChip({ activity }: { activity: ToolActivity }) {
  if (activity.kind === 'search') {
    return (
      <span className={`activity-chip ${activity.done ? 'done' : 'pending'}`}>
        🔍 {activity.done ? 'searched' : 'searching'} "{activity.query}"
      </span>
    )
  }
  if (activity.kind === 'browse') {
    const host = (() => { try { return new URL(activity.url).hostname } catch { return activity.url } })()
    return (
      <span className={`activity-chip ${activity.done ? 'done' : 'pending'}`}>
        🌐 {activity.done ? 'browsed' : 'browsing'} {host}
      </span>
    )
  }
  if (activity.kind === 'checkpoint') {
    return (
      <div className="checkpoint-chip">
        <span className="checkpoint-icon">◈</span>
        <span className="checkpoint-text">{activity.summary} <span className="checkpoint-count">+{activity.totalAdded} total</span></span>
      </div>
    )
  }
  return (
    <span className="activity-chip done">
      ➕ added {activity.count} resource{activity.count !== 1 ? 's' : ''} to KB
    </span>
  )
}

export default function ChatTab() {
  const { kb, refresh } = useKB()
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory())
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selfResearch, setSelfResearch] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const signalRef = useRef<AgentSignal>({ cancelled: false })

  // Persist history whenever non-activity messages change
  useEffect(() => {
    saveHistory(messages)
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg])
    return msg.id
  }, [])

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  const cancel = useCallback(() => {
    signalRef.current.cancelled = true
  }, [])

  const clearHistory = useCallback(() => {
    setMessages([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const submit = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    setInput('')
    setLoading(true)
    signalRef.current = { cancelled: false }

    addMessage({ id: uid(), role: 'user', content: text, timestamp: Date.now() })

    const assistantId = uid()
    addMessage({ id: assistantId, role: 'assistant', content: '', timestamp: Date.now() })

    try {
      let finalContent = ''

      await runAgent(
        text,
        kb,
        (activity: ToolActivity) => {
          const actId = uid()
          addMessage({ id: actId, role: 'tool-activity', content: '', activity, timestamp: Date.now() })
          if (activity.kind !== 'add_resources') {
            setTimeout(() => {
              setMessages((prev) => prev.map((m) => {
                if (m.id === actId && m.activity && m.activity.kind === activity.kind) {
                  return { ...m, activity: { ...m.activity, done: true } as ToolActivity }
                }
                return m
              }))
            }, 300)
          }
          if (activity.kind === 'add_resources') void refresh()
        },
        (partial: string) => {
          finalContent = partial
          updateMessage(assistantId, { content: partial })
        },
        signalRef.current,
        selfResearch,
      )

      if (!finalContent) {
        updateMessage(assistantId, { content: '(No response)' })
      }
    } catch (err) {
      updateMessage(assistantId, { content: `Error: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setLoading(false)
    }
  }, [input, loading, kb, addMessage, updateMessage, refresh])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  const showWelcome = messages.filter((m) => m.role === 'user' || m.role === 'assistant').length === 0

  return (
    <div className="chat-root">
      <div className="chat-messages">
        {showWelcome && (
          <div className="chat-welcome">
            <div className="welcome-icon">⌘</div>
            <h2>AI Timelines Chat</h2>
            <p>Ask about AI history, papers, or models. The assistant will search the web and build your knowledge base.</p>
            <div className="suggestions">
              {[
                'Add all important CVPR papers from 2020 to 2025',
                'Build a timeline of major AI model releases from 2017 to today',
                'What is the Transformer architecture and why did it matter?',
              ].map((s) => (
                <button key={s} className="suggestion-btn" onClick={() => { setInput(s); textareaRef.current?.focus() }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            {msg.role === 'tool-activity' && msg.activity ? (
              <ActivityChip activity={msg.activity} />
            ) : (
              <>
                <div className="message-role">{msg.role === 'user' ? 'You' : 'AI'}</div>
                <div className="message-content">
                  {msg.content || (msg.role === 'assistant' && loading ? <span className="typing-dots">●●●</span> : '')}
                </div>
              </>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className={`chat-input-bar ${selfResearch ? 'self-research-active' : ''}`}>
        {!showWelcome && (
          <button className="clear-btn" onClick={clearHistory} title="Clear chat history" disabled={loading}>
            ✕
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={selfResearch && loading ? 'Self-research running… hit ◼ to stop' : 'Ask about AI history… (Enter to send, Shift+Enter for newline)'}
          rows={2}
          disabled={loading && selfResearch}
        />
        <button
          className={`self-research-btn ${selfResearch ? 'on' : ''}`}
          onClick={() => setSelfResearch((v) => !v)}
          title={selfResearch ? 'Self-research ON — click to disable' : 'Enable self-research mode (no cap)'}
          disabled={loading}
        >
          ⟳
        </button>
        {loading ? (
          <button className="send-btn cancel-btn" onClick={cancel} title="Stop">
            ◼
          </button>
        ) : (
          <button
            className="send-btn"
            onClick={() => void submit()}
            disabled={!input.trim()}
          >
            ⏎
          </button>
        )}
      </div>
    </div>
  )
}
