import { useMemo } from 'react'
import { useKB } from '../kb/useKnowledgeBase'
import type { Resource } from '../types'

const TYPE_COLORS: Record<Resource['type'], string> = {
  paper: '#7c6ef5',
  model: '#22d3ee',
  event: '#f59e0b',
  article: '#34d399',
  dataset: '#f472b6',
  org: '#fb923c',
  other: '#94a3b8',
}

const TYPE_ICONS: Record<Resource['type'], string> = {
  paper: '📄',
  model: '🤖',
  event: '⚡',
  article: '📰',
  dataset: '🗄️',
  org: '🏢',
  other: '◈',
}

export default function TimelineTab() {
  const { kb, loading } = useKB()

  const { dated, undated } = useMemo(() => {
    const dated = kb.resources
      .filter((r) => r.date)
      .sort((a, b) => (a.date! < b.date! ? -1 : 1))
    const undated = kb.resources.filter((r) => !r.date)
    return { dated, undated }
  }, [kb.resources])

  const yearGroups = useMemo(() => {
    const groups: Record<string, Resource[]> = {}
    for (const r of dated) {
      const year = r.date!.slice(0, 4)
      ;(groups[year] ??= []).push(r)
    }
    return Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1))
  }, [dated])

  if (loading) return <div className="empty-state">Loading knowledge base…</div>

  if (dated.length === 0 && undated.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⟶</div>
        <h2>Timeline is empty</h2>
        <p>Go to the Chat tab and ask about AI history to populate the timeline.</p>
      </div>
    )
  }

  return (
    <div className="timeline-root">
      <div className="timeline-track">
        {yearGroups.map(([year, resources]) => (
          <div key={year} className="timeline-year-group">
            <div className="timeline-year-label">{year}</div>
            <div className="timeline-events">
              {resources.map((r) => (
                <TimelineCard key={r.id} resource={r} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {undated.length > 0 && (
        <div className="timeline-undated">
          <h3 className="undated-heading">No date</h3>
          <div className="undated-grid">
            {undated.map((r) => (
              <TimelineCard key={r.id} resource={r} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineCard({ resource: r, compact }: { resource: Resource; compact?: boolean }) {
  const color = TYPE_COLORS[r.type]
  const icon = TYPE_ICONS[r.type]

  return (
    <div className={`timeline-card ${compact ? 'compact' : ''}`} style={{ '--accent': color } as React.CSSProperties}>
      <div className="card-dot" style={{ background: color }} />
      <div className="card-body">
        <div className="card-meta">
          <span className="card-type-badge" style={{ color, borderColor: color }}>
            {icon} {r.type}
          </span>
          {r.date && <span className="card-date">{r.date}</span>}
        </div>
        <h3 className="card-title">
          {r.url ? (
            <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
          ) : (
            r.title
          )}
        </h3>
        {!compact && <p className="card-summary">{r.summary}</p>}
        {r.tags.length > 0 && (
          <div className="card-tags">
            {r.tags.slice(0, 5).map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
