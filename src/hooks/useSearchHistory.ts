import { useCallback, useState } from 'react'
import {
  clearSearchHistory,
  loadSearchHistory,
  pushSearchHistory,
} from '../lib/storage/searchHistory'
import type { SearchRecord } from '../types/parcel'

export function useSearchHistory() {
  const [searchHistory, setSearchHistory] = useState<SearchRecord[]>(() =>
    loadSearchHistory(),
  )

  const push = useCallback((item: SearchRecord) => {
    setSearchHistory((current) => pushSearchHistory(current, item))
  }, [])

  const clear = useCallback(() => {
    clearSearchHistory()
    setSearchHistory([])
  }, [])

  return { searchHistory, push, clear }
}
