import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Map as MapboxMap } from 'mapbox-gl'
import {
  buildParcelViewportIndex,
  queryParcelsInBounds,
} from '../lib/geo/parcelViewportIndex'
import type { ParcelFeature } from '../types/parcel'

function maxParcelsForZoom(zoom: number): number {
  if (zoom < 11) return 2800
  if (zoom < 12) return 5000
  if (zoom < 13) return 8000
  if (zoom < 14) return 12000
  return 22000
}

function sameParcelIdOrder(a: ParcelFeature[], b: ParcelFeature[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.properties.id !== b[i]?.properties.id) return false
  }
  return true
}

export function useRenderedParcels(parcels: ParcelFeature[], map: MapboxMap | null) {
  const [renderedParcels, setRenderedParcels] = useState<ParcelFeature[]>([])
  const viewportIndex = useMemo(() => buildParcelViewportIndex(parcels), [parcels])

  const update = useCallback(() => {
    if (parcels.length === 0) {
      setRenderedParcels([])
      return
    }

    if (!map) {
      setRenderedParcels((current) => {
        const fallback = parcels.slice(0, 4500)
        return sameParcelIdOrder(current, fallback) ? current : fallback
      })
      return
    }

    const bounds = map.getBounds()
    if (!bounds) return

    const center = map.getCenter()
    // Query with padded bounds and a zoom-based cap to keep source updates lightweight.
    const next = queryParcelsInBounds(viewportIndex, bounds, {
      paddingRatio: 0.24,
      maxFeatures: maxParcelsForZoom(map.getZoom()),
      center: [center.lng, center.lat],
    })

    setRenderedParcels((current) => (sameParcelIdOrder(current, next) ? current : next))
  }, [map, parcels, viewportIndex])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      update()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [update])

  useEffect(() => {
    if (!map) return
    map.on('moveend', update)
    return () => {
      map.off('moveend', update)
    }
  }, [map, update])

  return renderedParcels
}
