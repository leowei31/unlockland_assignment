import { useEffect, useRef } from 'react'
import type { FeatureCollection, Polygon } from 'geojson'
import mapboxgl, { type GeoJSONSource, type Map as MapboxMap } from 'mapbox-gl'
import { toEdgeFeatureCollection } from '../../lib/geo/edgeFeatures'
import type {
  ParcelAnalysis,
  ParcelFeature,
  ParcelFeatureCollection,
} from '../../types/parcel'

const PARCEL_SOURCE_ID = 'parcels-source'
const PARCEL_FILL_LAYER_ID = 'parcels-fill-layer'
const PARCEL_OUTLINE_LAYER_ID = 'parcels-outline-layer'
const SELECTED_LAYER_ID = 'parcels-selected-layer'
const EDGE_SOURCE_ID = 'selected-edges-source'
const EDGE_LAYER_ID = 'selected-edges-layer'
const EDGE_LABEL_LAYER_ID = 'selected-edges-label-layer'

const VANCOUVER_DOWNTOWN_CENTER: [number, number] = [-123.1207, 49.2827]

function emptyParcels(): ParcelFeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function toParcelsCollection(features: ParcelFeature[]): ParcelFeatureCollection {
  return { type: 'FeatureCollection', features }
}

function ensureMapLayers(map: MapboxMap): void {
  if (!map.getSource(PARCEL_SOURCE_ID)) {
    map.addSource(PARCEL_SOURCE_ID, {
      type: 'geojson',
      data: emptyParcels() as unknown as FeatureCollection<Polygon>,
    })
  }

  if (!map.getLayer(PARCEL_FILL_LAYER_ID)) {
    map.addLayer({
      id: PARCEL_FILL_LAYER_ID,
      type: 'fill',
      source: PARCEL_SOURCE_ID,
      paint: { 'fill-color': '#2a9d8f', 'fill-opacity': 0.22 },
    })
  }

  if (!map.getLayer(PARCEL_OUTLINE_LAYER_ID)) {
    map.addLayer({
      id: PARCEL_OUTLINE_LAYER_ID,
      type: 'line',
      source: PARCEL_SOURCE_ID,
      paint: { 'line-color': '#1d3557', 'line-width': 1 },
    })
  }

  if (!map.getLayer(SELECTED_LAYER_ID)) {
    map.addLayer({
      id: SELECTED_LAYER_ID,
      type: 'line',
      source: PARCEL_SOURCE_ID,
      paint: { 'line-color': '#d62828', 'line-width': 3 },
      filter: ['==', ['get', 'id'], '__none__'],
    })
  }

  if (!map.getSource(EDGE_SOURCE_ID)) {
    map.addSource(EDGE_SOURCE_ID, {
      type: 'geojson',
      data: toEdgeFeatureCollection(null),
    })
  }

  if (!map.getLayer(EDGE_LAYER_ID)) {
    map.addLayer({
      id: EDGE_LAYER_ID,
      type: 'line',
      source: EDGE_SOURCE_ID,
      paint: {
        'line-color': [
          'match',
          ['get', 'edgeType'],
          'Frontage', '#d62828',
          'Flankage', '#f77f00',
          'Rear Lane', '#2a9d8f',
          'Rear', '#264653',
          '#6c757d',
        ],
        'line-width': ['match', ['get', 'edgeType'], 'Frontage', 5, 'Flankage', 4, 3],
      },
    })
  }

  if (!map.getLayer(EDGE_LABEL_LAYER_ID)) {
    map.addLayer({
      id: EDGE_LABEL_LAYER_ID,
      type: 'symbol',
      source: EDGE_SOURCE_ID,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'label'],
        'text-size': 11,
        visibility: 'none',
      },
      paint: {
        'text-color': '#111111',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.2,
      },
    })
  }
}

function updateParcelsSource(map: MapboxMap, features: ParcelFeature[]): void {
  const source = map.getSource(PARCEL_SOURCE_ID) as GeoJSONSource | undefined
  if (!source) return
  source.setData(toParcelsCollection(features) as unknown as FeatureCollection<Polygon>)
}

function updateEdgesSource(map: MapboxMap, analysis: ParcelAnalysis | null): void {
  const source = map.getSource(EDGE_SOURCE_ID) as GeoJSONSource | undefined
  if (!source) return
  source.setData(toEdgeFeatureCollection(analysis))
}

function fitToParcel(map: MapboxMap, parcel: ParcelFeature): void {
  const ring = parcel.geometry.coordinates[0] ?? []
  if (ring.length === 0) return
  const bounds = new mapboxgl.LngLatBounds()
  for (const [lon, lat] of ring) bounds.extend([lon, lat])
  map.fitBounds(bounds, { padding: 80, duration: 700, maxZoom: 18 })
}

export interface ParcelMapProps {
  token: string
  mapStyle: string
  parcels: ParcelFeature[]
  selectedParcel: ParcelFeature | null
  selectedParcelId: string | null
  analysis: ParcelAnalysis | null
  debugMode: boolean
  onMapReady: (map: MapboxMap) => void
  onParcelSelect: (parcelId: string) => void
  onParcelViewReady?: (parcelId: string) => void
}

export function ParcelMap({
  token,
  mapStyle,
  parcels,
  selectedParcel,
  selectedParcelId,
  analysis,
  debugMode,
  onMapReady,
  onParcelSelect,
  onParcelViewReady,
}: ParcelMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const isLoadedRef = useRef(false)
  // Keep event handlers/state available to map callbacks without re-binding map events.
  const onMapReadyRef = useRef(onMapReady)
  const onParcelSelectRef = useRef(onParcelSelect)
  const onParcelViewReadyRef = useRef(onParcelViewReady)
  const parcelsRef = useRef(parcels)
  const analysisRef = useRef(analysis)
  const selectedParcelIdRef = useRef(selectedParcelId)
  const selectedParcelRef = useRef(selectedParcel)
  const debugModeRef = useRef(debugMode)
  const mapStyleRef = useRef(mapStyle)

  useEffect(() => { onMapReadyRef.current = onMapReady }, [onMapReady])
  useEffect(() => { onParcelSelectRef.current = onParcelSelect }, [onParcelSelect])
  useEffect(() => { onParcelViewReadyRef.current = onParcelViewReady }, [onParcelViewReady])
  useEffect(() => { parcelsRef.current = parcels }, [parcels])
  useEffect(() => { analysisRef.current = analysis }, [analysis])
  useEffect(() => { selectedParcelIdRef.current = selectedParcelId }, [selectedParcelId])
  useEffect(() => { selectedParcelRef.current = selectedParcel }, [selectedParcel])
  useEffect(() => { debugModeRef.current = debugMode }, [debugMode])
  useEffect(() => { mapStyleRef.current = mapStyle }, [mapStyle])

  // Map initialization
  useEffect(() => {
    if (!mapContainerRef.current) return undefined
    if (mapRef.current) return undefined

    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: mapStyleRef.current,
      center: VANCOUVER_DOWNTOWN_CENTER,
      zoom: 13.5,
      pitch: 0,
      bearing: 0,
      antialias: true,
    })

    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')

    map.on('load', () => {
      isLoadedRef.current = true
      ensureMapLayers(map)
      updateParcelsSource(map, parcelsRef.current)
      updateEdgesSource(map, analysisRef.current)
      onMapReadyRef.current(map)
    })

    map.on('click', PARCEL_FILL_LAYER_ID, (event) => {
      const [feature] = event.features ?? []
      const rawId = feature?.properties?.id
      const parcelId = typeof rawId === 'string' ? rawId : ''
      if (parcelId) onParcelSelectRef.current(parcelId)
    })

    map.on('mouseenter', PARCEL_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', PARCEL_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
    })

    return () => {
      map.remove()
      mapRef.current = null
      isLoadedRef.current = false
    }
  }, [token])

  // Handle map style switching (dark / light)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !isLoadedRef.current) return

    isLoadedRef.current = false
    map.setStyle(mapStyle)

    map.once('style.load', () => {
      // Style reload clears custom sources/layers, so we recreate and rehydrate them.
      isLoadedRef.current = true
      ensureMapLayers(map)
      updateParcelsSource(map, parcelsRef.current)
      updateEdgesSource(map, analysisRef.current)

      const currentId = selectedParcelIdRef.current
      map.setFilter(SELECTED_LAYER_ID, ['==', ['get', 'id'], currentId ?? '__none__'])

      if (debugModeRef.current) {
        map.setLayoutProperty(EDGE_LABEL_LAYER_ID, 'visibility', 'visible')
      }
    })
  }, [mapStyle])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isLoadedRef.current) return
    updateParcelsSource(map, parcels)
  }, [parcels])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isLoadedRef.current) return
    updateEdgesSource(map, analysis)
  }, [analysis])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isLoadedRef.current) return
    const target = selectedParcelId ?? '__none__'
    map.setFilter(SELECTED_LAYER_ID, ['==', ['get', 'id'], target])

    if (!selectedParcelId || !selectedParcel) return
    map.once('idle', () => {
      onParcelViewReadyRef.current?.(selectedParcelId)
    })
    fitToParcel(map, selectedParcel)
  }, [selectedParcelId, selectedParcel])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !isLoadedRef.current) return
    map.setLayoutProperty(EDGE_LABEL_LAYER_ID, 'visibility', debugMode ? 'visible' : 'none')
  }, [debugMode])

  return <div ref={mapContainerRef} className="map-container" />
}
