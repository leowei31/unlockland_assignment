import { useEffect, useState } from 'react'
import type { ParcelFeature, ParcelFeatureCollection, SearchRecord } from '../types/parcel'

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function sanitizeParcelFeature(raw: unknown): ParcelFeature | null {
  // Defensive parsing so malformed records do not break the app at runtime.
  if (!raw || typeof raw !== 'object') return null
  const feature = raw as {
    type?: unknown
    geometry?: unknown
    properties?: Record<string, unknown>
  }
  if (feature.type !== 'Feature') return null
  if (!feature.geometry || typeof feature.geometry !== 'object') return null

  const geometry = feature.geometry as { type?: unknown; coordinates?: unknown }
  if (geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return null

  const properties = feature.properties ?? {}
  const id = String(properties.id ?? '').trim()
  const fullAddress = String(properties.fullAddress ?? '').trim()
  const streetName = String(properties.streetName ?? '').trim()
  const lon = asNumber(properties.lon)
  const lat = asNumber(properties.lat)
  if (!id || !fullAddress || Number.isNaN(lon) || Number.isNaN(lat)) return null

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: geometry.coordinates as [number, number][][],
    },
    properties: {
      id,
      siteId: String(properties.siteId ?? ''),
      taxCoord: String(properties.taxCoord ?? ''),
      civicNumber: String(properties.civicNumber ?? ''),
      streetName,
      fullAddress,
      lon,
      lat,
    },
  }
}

function sanitizeSearchRecord(raw: unknown): SearchRecord | null {
  // Keep search index strict; skip anything missing id/address/coordinates.
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = String(item.id ?? '').trim()
  const address = String(item.address ?? '').trim()
  const lon = asNumber(item.lon)
  const lat = asNumber(item.lat)
  const streetName = String(item.streetName ?? '').trim()
  if (!id || !address || Number.isNaN(lon) || Number.isNaN(lat)) return null
  return { id, address, lon, lat, streetName }
}

export type LoadingState = 'idle' | 'loading' | 'ready' | 'error'

export function useParcelData() {
  const [parcels, setParcels] = useState<ParcelFeature[]>([])
  const [searchIndex, setSearchIndex] = useState<SearchRecord[]>([])
  const [loadingState, setLoadingState] = useState<LoadingState>('idle')

  useEffect(() => {
    let mounted = true
    setLoadingState('loading')

    const loadData = async () => {
      try {
        const [parcelsResponse, searchResponse] = await Promise.all([
          fetch('/data/parcels.geojson'),
          fetch('/data/search-index.json'),
        ])
        if (!parcelsResponse.ok || !searchResponse.ok) {
          throw new Error('Could not load local parcel data files.')
        }

        const parcelsJson = (await parcelsResponse.json()) as ParcelFeatureCollection
        const searchJson = (await searchResponse.json()) as SearchRecord[]
        if (!mounted) return

        const nextParcels = (parcelsJson.features ?? [])
          .map(sanitizeParcelFeature)
          .filter((f): f is ParcelFeature => f !== null)
        const nextSearch = (searchJson ?? [])
          .map(sanitizeSearchRecord)
          .filter((s): s is SearchRecord => s !== null)

        // One state update pass after both payloads are normalized.
        setParcels(nextParcels)
        setSearchIndex(nextSearch)
        setLoadingState('ready')
      } catch {
        if (!mounted) return
        setLoadingState('error')
      }
    }

    void loadData()

    return () => {
      mounted = false
    }
  }, [])

  return { parcels, searchIndex, loadingState }
}
