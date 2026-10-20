import { useMemo, useCallback, useState, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
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

const NODE_WIDTH = 180
const NODE_HEIGHT = 60

function layoutGraph(resources: Resource[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 80 })

  const idSet = new Set(resources.map((r) => r.id))

  for (const r of resources) {
    g.setNode(r.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  const edgeSet = new Set<string>()
  for (const r of resources) {
    for (const conn of r.connections) {
      if (idSet.has(conn.targetId)) {
        const key = `${r.id}->${conn.targetId}`
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          g.setEdge(r.id, conn.targetId, { label: conn.relation })
        }
      }
    }
  }

  dagre.layout(g)

  const nodes: Node[] = resources.map((r) => {
    const pos = g.node(r.id)
    return {
      id: r.id,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      data: { label: r.title, resource: r },
      style: {
        background: '#1a1f2e',
        border: `2px solid ${TYPE_COLORS[r.type]}`,
        color: '#e2e8f0',
        borderRadius: 8,
        fontSize: 12,
        width: NODE_WIDTH,
        padding: '8px 12px',
      },
    }
  })

  const edges: Edge[] = []
  for (const e of g.edges()) {
    const edgeData = g.edge(e)
    edges.push({
      id: `${e.v}-${e.w}`,
      source: e.v,
      target: e.w,
      label: edgeData.label as string,
      style: { stroke: '#334155', strokeWidth: 1.5 },
      labelStyle: { fill: '#64748b', fontSize: 10 },
      animated: false,
    })
  }

  return { nodes, edges }
}

export default function TreeTab() {
  const { kb, loading } = useKB()
  const [selected, setSelected] = useState<Resource | null>(null)

  const { layoutNodes, layoutEdges } = useMemo(() => {
    const { nodes, edges } = layoutGraph(kb.resources)
    return { layoutNodes: nodes, layoutEdges: edges }
  }, [kb.resources])

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges)

  // Sync whenever the KB changes (new resources added while tab is mounted)
  useEffect(() => {
    setNodes(layoutNodes)
    setEdges(layoutEdges)
  }, [layoutNodes, layoutEdges, setNodes, setEdges])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const r = kb.resources.find((r) => r.id === node.id)
      setSelected(r ?? null)
    },
    [kb.resources],
  )

  if (loading) return <div className="empty-state">Loading…</div>

  if (kb.resources.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⬡</div>
        <h2>Knowledge Tree is empty</h2>
        <p>Chat with the AI to build the knowledge base, then come back here.</p>
      </div>
    )
  }

  return (
    <div className="tree-root">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        colorMode="dark"
      >
        <Background color="#1e293b" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const r = kb.resources.find((r) => r.id === node.id)
            return r ? TYPE_COLORS[r.type] : '#94a3b8'
          }}
          style={{ background: '#0f172a' }}
        />
      </ReactFlow>

      {selected && (
        <div className="tree-detail-panel">
          <button className="close-btn" onClick={() => setSelected(null)}>✕</button>
          <div className="detail-type" style={{ color: TYPE_COLORS[selected.type] }}>
            {selected.type}
          </div>
          <h2 className="detail-title">
            {selected.url ? (
              <a href={selected.url} target="_blank" rel="noopener noreferrer">{selected.title}</a>
            ) : selected.title}
          </h2>
          {selected.date && <div className="detail-date">{selected.date}</div>}
          <p className="detail-summary">{selected.summary}</p>
          {selected.tags.length > 0 && (
            <div className="card-tags">
              {selected.tags.map((t) => <span key={t} className="tag">{t}</span>)}
            </div>
          )}
          {selected.connections.length > 0 && (
            <div className="detail-connections">
              <strong>Connections</strong>
              <ul>
                {selected.connections.map((c, i) => (
                  <li key={i}><span className="conn-rel">{c.relation}</span> → {c.targetId}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
