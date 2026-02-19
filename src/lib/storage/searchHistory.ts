import type { SearchRecord } from '../../types/parcel'

const HISTORY_KEY = 'unlockland_search_history'
const MAX_HISTORY_ITEMS = 10

export function loadSearchHistory(): SearchRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as SearchRecord[]
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item) => item && typeof item.id === 'string' && typeof item.address === 'string')
      .slice(0, MAX_HISTORY_ITEMS)
  } catch {
    return []
  }
}

export function saveSearchHistory(items: SearchRecord[]): void {
  const bounded = items.slice(0, MAX_HISTORY_ITEMS)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(bounded))
}

export function pushSearchHistory(
  current: SearchRecord[],
  item: SearchRecord,
): SearchRecord[] {
  const next = [item, ...current.filter((entry) => entry.id !== item.id)].slice(
    0,
    MAX_HISTORY_ITEMS,
  )
  saveSearchHistory(next)
  return next
}

export function clearSearchHistory(): void {
  localStorage.removeItem(HISTORY_KEY)
}
