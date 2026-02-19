import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Map as MapboxMap } from 'mapbox-gl'
import { DebugPanel } from './features/debug/DebugPanel'
import { ParcelMap } from './features/map/ParcelMap'
import { InfoCard } from './features/parcels/InfoCard'
import { SearchBar } from './features/search/SearchBar'
import { useDebounce } from './hooks/useDebounce'
import { useParcelData } from './hooks/useParcelData'
import { useParcelSelection } from './hooks/useParcelSelection'
import { useRenderedParcels } from './hooks/useRenderedParcels'
import { useSearchHistory } from './hooks/useSearchHistory'
import { useTheme } from './hooks/useTheme'
import type { SearchRecord } from './types/parcel'

function scoreResult(address: string, term: string): number {
  const lower = address.toLowerCase()
  if (lower.startsWith(term)) return 0
  if (lower.includes(term)) return 1
  return 2
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function App() {
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? ''
  const { isDark, toggle: toggleTheme } = useTheme()
  const { parcels, searchIndex, loadingState } = useParcelData()
  const { searchHistory, push: pushHistory, clear: clearHistory } = useSearchHistory()
  const [map, setMap] = useState<MapboxMap | null>(null)
  const [debugMode, setDebugMode] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const debouncedSearchValue = useDebounce(searchValue.trim(), 250)

  const { selectedParcelId, selectedParcel, analysis, select, parcelsById, refreshAnalysis } =
    useParcelSelection(parcels, map)
  const renderedParcels = useRenderedParcels(parcels, map)

  // Viewport rendering keeps the map fast, but the selected parcel should always stay visible.
  const mapParcels = useMemo(() => {
    if (!selectedParcel) return renderedParcels
    const exists = renderedParcels.some((p) => p.properties.id === selectedParcel.properties.id)
    if (exists) return renderedParcels
    return [selectedParcel, ...renderedParcels]
  }, [renderedParcels, selectedParcel])

  const showHistory = searchFocused && searchValue.trim().length === 0

  const searchResults = useMemo(() => {
    const term = debouncedSearchValue.toLowerCase()
    if (!term) return []
    // Keep ranking deterministic and easy to reason about.
    return [...searchIndex]
      .filter((record) => record.address.toLowerCase().includes(term))
      .sort((a, b) => {
        const scoreA = scoreResult(a.address, term)
        const scoreB = scoreResult(b.address, term)
        if (scoreA !== scoreB) return scoreA - scoreB
        return a.address.localeCompare(b.address)
      })
      .slice(0, 8)
  }, [debouncedSearchValue, searchIndex])

  const selectParcel = useCallback(
    (parcelId: string, source: 'map' | 'search' | 'history') => {
      // Single selection entrypoint so map click/search/history all follow identical behavior.
      select(parcelId)
      if (source !== 'map') {
        const parcel = parcelsById.get(parcelId)
        if (parcel) {
          pushHistory({
            id: parcel.properties.id,
            address: parcel.properties.fullAddress,
            lon: parcel.properties.lon,
            lat: parcel.properties.lat,
            streetName: parcel.properties.streetName,
          })
        }
      }
    },
    [select, parcelsById, pushHistory],
  )

  const handleSearchSelect = useCallback(
    (item: SearchRecord, source: 'search' | 'history') => {
      setSearchValue(item.address)
      setSearchFocused(false)
      selectParcel(item.id, source)
    },
    [selectParcel],
  )

  const handleMapParcelSelect = useCallback(
    (parcelId: string) => selectParcel(parcelId, 'map'),
    [selectParcel],
  )

  const handleParcelViewReady = useCallback(
    (parcelId: string) => {
      if (!map) return
      // Re-analyze once the map settles after fly-to so rendered road vectors are up to date.
      refreshAnalysis(parcelId, map)
    },
    [map, refreshAnalysis],
  )

  const mapStyle = isDark
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/streets-v12'

  useEffect(() => {
    if (!map) return
    if (searchFocused) {
      map.keyboard.disable()
      return
    }
    map.keyboard.enable()
  }, [map, searchFocused])

  if (!mapboxToken) {
    return (
      <main className="min-h-screen p-3.5 flex flex-col items-center justify-center text-center bg-app-bg">
        <h1 className="text-3xl font-bold mb-3 text-foreground">UnlockLand</h1>
        <p className="text-muted max-w-md leading-relaxed">
          Missing <code>VITE_MAPBOX_ACCESS_TOKEN</code>. Add it in a <code>.env</code> file and
          restart the dev server.
        </p>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-3.5 flex flex-col gap-3 bg-app-bg font-sans">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 px-4 py-2.5 bg-surface border border-border rounded-2xl shadow-sm">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-bold tracking-tight leading-none text-foreground">
            UnlockLand
          </h1>
          <span className="text-[0.73rem] font-medium text-muted-soft">
            Vancouver Parcel Analysis
          </span>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-xl">
          <SearchBar
            value={searchValue}
            results={searchResults}
            history={searchHistory}
            isFocused={searchFocused}
            showHistory={showHistory}
            onChange={setSearchValue}
            onSelect={handleSearchSelect}
            onFocusChange={setSearchFocused}
            onClearHistory={clearHistory}
          />

          {/* Theme toggle */}
          <button
            type="button"
            className="w-9 h-9 flex items-center justify-center border border-border bg-surface text-muted rounded-lg cursor-pointer shrink-0 transition-colors hover:bg-surface-hover hover:border-border-strong"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Debug toggle */}
          <button
            type="button"
            className={clsx(
              'h-9 flex items-center justify-center border rounded-lg px-3 text-sm font-medium cursor-pointer whitespace-nowrap transition-colors',
              debugMode
                ? 'border-brand text-brand bg-brand/10'
                : 'border-border bg-surface text-muted hover:bg-surface-hover hover:border-border-strong',
            )}
            onClick={() => setDebugMode((v) => !v)}
          >
            {debugMode ? 'Debug: ON' : 'Debug: OFF'}
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 grid grid-cols-[1fr_336px] gap-3 min-h-0 max-[1080px]:grid-cols-1">
        {/* Map */}
        <section className="relative rounded-2xl overflow-hidden border border-border min-h-[560px] shadow-sm max-[1080px]:min-h-[480px]">
          {loadingState === 'ready' && (
            <ParcelMap
              token={mapboxToken}
              mapStyle={mapStyle}
              parcels={mapParcels}
              selectedParcel={selectedParcel}
              selectedParcelId={selectedParcelId}
              analysis={analysis}
              debugMode={debugMode}
              onMapReady={setMap}
              onParcelSelect={handleMapParcelSelect}
              onParcelViewReady={handleParcelViewReady}
            />
          )}
          {loadingState === 'loading' && (
            <div className="h-full flex flex-col items-center justify-center gap-3 bg-surface text-muted text-sm font-medium">
              <div className="w-6 h-6 rounded-full border-[2.5px] border-border border-t-accent animate-spin" />
              <span>Loading parcel data...</span>
            </div>
          )}
          {loadingState === 'error' && (
            <div className="h-full flex flex-col items-center justify-center gap-2 bg-surface text-error text-sm font-medium text-center px-6">
              Failed to load parcel data. Check that{' '}
              <code>public/data/parcels.geojson</code> and{' '}
              <code>public/data/search-index.json</code> exist.
            </div>
          )}
        </section>

        {/* Sidebar */}
        <aside className="flex flex-col gap-2.5 overflow-y-auto">
          <InfoCard selectedParcel={selectedParcel} analysis={analysis} />

          {/* Edge Legend */}
          <section className="panel">
            <h2 className="text-[0.7rem] font-semibold tracking-[0.06em] uppercase text-muted-soft mb-3">
              Edge Legend
            </h2>
            {[
              { label: 'Frontage', color: '#d62828' },
              { label: 'Flankage', color: '#f77f00' },
              { label: 'Rear Lane', color: '#2a9d8f' },
              { label: 'Rear', color: '#264653' },
              { label: 'Side', color: '#6c757d' },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2.5 text-sm text-muted py-1">
                <span
                  className="w-[22px] h-[3px] rounded-full shrink-0"
                  style={{ background: color }}
                />
                {label}
              </div>
            ))}
          </section>

          {debugMode && <DebugPanel selectedParcel={selectedParcel} analysis={analysis} />}
        </aside>
      </div>
    </main>
  )
}

export default App

