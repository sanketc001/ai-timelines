import { useState } from 'react'
import { KBContext, useKnowledgeBase } from './kb/useKnowledgeBase'
import TimelineTab from './tabs/TimelineTab'
import TreeTab from './tabs/TreeTab'
import ChatTab from './tabs/ChatTab'

type Tab = 'timeline' | 'tree' | 'chat'

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const kbValue = useKnowledgeBase()

  return (
    <KBContext.Provider value={kbValue}>
      <div className="app">
        <header className="app-header">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">AI Timelines</span>
          </div>
          <nav className="tab-nav">
            {(['timeline', 'tree', 'chat'] as Tab[]).map((tab) => (
              <button
                key={tab}
                className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'timeline' && '⟶ Timeline'}
                {tab === 'tree' && '⬡ Knowledge Tree'}
                {tab === 'chat' && '⌘ Chat'}
              </button>
            ))}
          </nav>
          <div className="kb-count">
            {kbValue.kb.resources.length} resources
          </div>
        </header>

        <main className="app-main">
          <div className={`tab-panel${activeTab === 'timeline' ? ' tab-panel--active' : ''}`}><TimelineTab /></div>
          <div className={`tab-panel${activeTab === 'tree' ? ' tab-panel--active' : ''}`}><TreeTab /></div>
          <div className={`tab-panel${activeTab === 'chat' ? ' tab-panel--active' : ''}`}><ChatTab /></div>
        </main>
      </div>
    </KBContext.Provider>
  )
}
