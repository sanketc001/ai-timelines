import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import type { KnowledgeBase } from '../types'

interface KBContextValue {
  kb: KnowledgeBase
  loading: boolean
  refresh: () => Promise<void>
}

export const KBContext = createContext<KBContextValue>({
  kb: { resources: [] },
  loading: true,
  refresh: async () => {},
})

export function useKnowledgeBase(): KBContextValue {
  const [kb, setKB] = useState<KnowledgeBase>({ resources: [] })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/kb')
      const data = (await res.json()) as KnowledgeBase
      setKB(data)
    } catch {
      // silently ignore — kb stays as-is
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { kb, loading, refresh }
}

export function useKB(): KBContextValue {
  return useContext(KBContext)
}
