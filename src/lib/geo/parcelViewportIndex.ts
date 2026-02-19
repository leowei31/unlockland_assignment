import type { ParcelFeature, Position } from '../../types/parcel'

const DEFAULT_CELL_SIZE_DEG = 0.005

export interface BoundsLike {
  getWest: () => number
  getEast: () => number
  getSouth: () => number
  getNorth: () => number
}

export interface ParcelViewportIndex {
  cellSizeDeg: number
  cells: Map<string, ParcelFeature[]>
}

export interface QueryParcelsOptions {
  paddingRatio?: number
  maxFeatures?: number
  center?: Position
}

function cellIndex(value: number, cellSizeDeg: number): number {
  return Math.floor(value / cellSizeDeg)
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`
}

function distanceSq(a: Position, b: Position): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

export function buildParcelViewportIndex(
  parcels: ParcelFeature[],
  cellSizeDeg = DEFAULT_CELL_SIZE_DEG,
): ParcelViewportIndex {
  const cells = new Map<string, ParcelFeature[]>()

  for (const parcel of parcels) {
    const lon = parcel.properties.lon
    const lat = parcel.properties.lat
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

    const x = cellIndex(lon, cellSizeDeg)
    const y = cellIndex(lat, cellSizeDeg)
    const key = cellKey(x, y)

    const current = cells.get(key)
    if (current) {
      current.push(parcel)
    } else {
      cells.set(key, [parcel])
    }
  }

  return {
    cellSizeDeg,
    cells,
  }
}

export function queryParcelsInBounds(
  index: ParcelViewportIndex,
  bounds: BoundsLike,
  options: QueryParcelsOptions = {},
): ParcelFeature[] {
  const { paddingRatio = 0.22, maxFeatures = Number.POSITIVE_INFINITY, center } = options
  const west = bounds.getWest()
  const east = bounds.getEast()
  const south = bounds.getSouth()
  const north = bounds.getNorth()

  const lonSpan = Math.max(0, east - west)
  const latSpan = Math.max(0, north - south)
  const paddedWest = west - lonSpan * paddingRatio
  const paddedEast = east + lonSpan * paddingRatio
  const paddedSouth = south - latSpan * paddingRatio
  const paddedNorth = north + latSpan * paddingRatio

  const minX = cellIndex(paddedWest, index.cellSizeDeg)
  const maxX = cellIndex(paddedEast, index.cellSizeDeg)
  const minY = cellIndex(paddedSouth, index.cellSizeDeg)
  const maxY = cellIndex(paddedNorth, index.cellSizeDeg)

  const selected: ParcelFeature[] = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const bucket = index.cells.get(cellKey(x, y))
      if (!bucket) continue
      for (const parcel of bucket) {
        const lon = parcel.properties.lon
        const lat = parcel.properties.lat
        if (lon < paddedWest || lon > paddedEast || lat < paddedSouth || lat > paddedNorth) {
          continue
        }
        selected.push(parcel)
      }
    }
  }

  if (selected.length <= maxFeatures) return selected

  const fallbackCenter: Position = center ?? [
    (paddedWest + paddedEast) / 2,
    (paddedSouth + paddedNorth) / 2,
  ]
  selected.sort((a, b) => {
    const da = distanceSq([a.properties.lon, a.properties.lat], fallbackCenter)
    const db = distanceSq([b.properties.lon, b.properties.lat], fallbackCenter)
    return da - db
  })

  return selected.slice(0, maxFeatures)
}
