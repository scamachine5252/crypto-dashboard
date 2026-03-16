'use client'

import { useState, useCallback } from 'react'
import { EXCHANGES } from '@/lib/mock-data'

const ALL_IDS = EXCHANGES.flatMap((ex) => ex.subAccounts).map((a) => a.id)

export function useAccountToggles(initialIds?: string[]) {
  const [activeIds, setActiveIds] = useState<Set<string>>(
    new Set(initialIds ?? ALL_IDS),
  )

  const toggleAccount = useCallback((id: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size > 1) next.delete(id) // always keep at least one
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleExchange = useCallback((exId: string) => {
    const exIds = new Set(
      EXCHANGES.find((e) => e.id === exId)?.subAccounts.map((s) => s.id) ?? [],
    )
    setActiveIds((prev) => {
      const allOn = [...exIds].every((id) => prev.has(id))
      const next = new Set(prev)
      if (allOn) {
        // Only turn off if it won't leave nothing active
        const remaining = [...prev].filter((id) => !exIds.has(id))
        if (remaining.length > 0) exIds.forEach((id) => next.delete(id))
      } else {
        exIds.forEach((id) => next.add(id))
      }
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setActiveIds(new Set(ALL_IDS))
  }, [])

  const reset = useCallback(() => {
    setActiveIds(new Set([ALL_IDS[0]]))
  }, [])

  return { activeIds, toggleAccount, toggleExchange, selectAll, reset }
}
