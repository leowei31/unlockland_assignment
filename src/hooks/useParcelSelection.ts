import { useCallback, useMemo, useState } from 'react'
import type { Map as MapboxMap } from 'mapbox-gl'
import { analyzeParcel } from '../lib/geo/parcelAnalysis'
import type { ParcelAnalysis, ParcelFeature } from '../types/parcel'

export function useParcelSelection(parcels: ParcelFeature[], map: MapboxMap | null) {
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null)
  // Optional override used after map fly-to when rendered vectors are stable.
  const [analysisOverride, setAnalysisOverride] = useState<{
    parcelId: string
    analysis: ParcelAnalysis
  } | null>(null)

  const parcelsById = useMemo(() => {
    const byId = new Map<string, ParcelFeature>()
    for (const parcel of parcels) {
      byId.set(parcel.properties.id, parcel)
    }
    return byId
  }, [parcels])

  const selectedParcel = useMemo(
    () => (selectedParcelId ? (parcelsById.get(selectedParcelId) ?? null) : null),
    [parcelsById, selectedParcelId],
  )

  const computedAnalysis = useMemo(() => {
    if (!selectedParcel) return null
    return analyzeParcel(selectedParcel, map ?? undefined)
  }, [selectedParcel, map])

  const analysis = useMemo(() => {
    if (!selectedParcelId) return null
    // Prefer explicit post-fit analysis for the currently selected parcel.
    if (analysisOverride?.parcelId === selectedParcelId) {
      return analysisOverride.analysis
    }
    return computedAnalysis
  }, [selectedParcelId, analysisOverride, computedAnalysis])

  const select = useCallback((parcelId: string) => {
    setAnalysisOverride(null)
    setSelectedParcelId(parcelId)
  }, [])

  const refreshAnalysis = useCallback(
    (parcelId: string, currentMap: MapboxMap) => {
      const parcel = parcelsById.get(parcelId)
      if (!parcel) return
      setAnalysisOverride({
        parcelId,
        analysis: analyzeParcel(parcel, currentMap),
      })
    },
    [parcelsById],
  )

  return { selectedParcelId, selectedParcel, analysis, select, parcelsById, refreshAnalysis }
}
