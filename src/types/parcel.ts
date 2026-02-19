export type Position = [number, number]

export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: Position[][]
}

export interface ParcelProperties {
  id: string
  siteId: string
  taxCoord: string
  civicNumber: string
  streetName: string
  fullAddress: string
  lon: number
  lat: number
}

export interface ParcelFeature {
  type: 'Feature'
  geometry: PolygonGeometry
  properties: ParcelProperties
}

export interface ParcelFeatureCollection {
  type: 'FeatureCollection'
  features: ParcelFeature[]
}

export type EdgeType = 'Frontage' | 'Flankage' | 'Rear Lane' | 'Rear' | 'Side'
export type RoadKind = 'street' | 'lane' | null
export type LotType =
  | 'Corner Lot'
  | 'Double Fronting'
  | 'Standard with Lane'
  | 'Standard without Lane'

export interface EdgeAnalysis {
  index: number
  start: Position
  end: Position
  midpoint: Position
  lengthMeters: number
  type: EdgeType
  roadKind: RoadKind
  roadName: string
  roadClass: string
  roadDistanceMeters: number | null
  orientationDiffDeg: number | null
  isRoadAdjacent: boolean
  debug: string
}

export interface ParcelAnalysis {
  areaM2: number
  primaryStreet: string
  lotType: LotType
  reason: string
  confidence: 'high' | 'medium' | 'low'
  edges: EdgeAnalysis[]
}

export interface SearchRecord {
  id: string
  address: string
  lon: number
  lat: number
  streetName: string
}
