import {
  area,
  bearing,
  distance,
  lineString,
  point,
  pointToLineDistance,
} from '@turf/turf'
import type { Feature, Polygon } from 'geojson'
import type { GeoJSONFeature, Map as MapboxMap } from 'mapbox-gl'
import type {
  EdgeAnalysis,
  EdgeType,
  LotType,
  ParcelAnalysis,
  ParcelFeature,
  Position,
  RoadKind,
} from '../../types/parcel'

// Tuned for MVP balance: stricter street proximity to reduce frontage/flankage false positives.
const ROAD_PROXIMITY_THRESHOLD_METERS = 20
const LANE_PROXIMITY_THRESHOLD_METERS = 28
const ROAD_ORIENTATION_THRESHOLD_DEG = 55
const LANE_ORIENTATION_THRESHOLD_DEG = 85
const RELAXED_FRONTAGE_STREET_DISTANCE_METERS = 30
const RELAXED_FRONTAGE_STREET_ORIENTATION_DEG = 85
const RELAXED_FLANKAGE_STREET_DISTANCE_METERS = 24
const RELAXED_FLANKAGE_STREET_ORIENTATION_DEG = 70
const RELAXED_LANE_DISTANCE_METERS = 42
const RELAXED_LANE_ORIENTATION_DEG = 110
const EDGE_QUERY_BUFFER_METERS = 52
const MIN_QUERY_PADDING_PX = 38
const MAX_QUERY_PADDING_PX = 220
const OPPOSITE_EDGE_STRICT_ORIENTATION_DEG = 38
const OPPOSITE_EDGE_RELAXED_ORIENTATION_DEG = 62
const EDGE_SELECTION_DISTANCE_TIE_METERS = 3
const EDGE_SELECTION_LENGTH_TIE_METERS = 1

interface RoadCandidate {
  name: string
  kind: Exclude<RoadKind, null>
  className: string
  sourceLayer: string
  lines: Position[][]
}

interface EvaluatedRoadCandidate extends RoadCandidate {
  distanceMeters: number
  orientationDiffDeg: number
  score: number
  isAdjacent: boolean
}

function normalizeStreetName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\bst\b/g, 'street')
    .replace(/\bave\b/g, 'avenue')
    .replace(/\bblvd\b/g, 'boulevard')
    .replace(/\brd\b/g, 'road')
    .replace(/\bdr\b/g, 'drive')
    .replace(/\bln\b/g, 'lane')
    .replace(/\bn\b/g, 'north')
    .replace(/\bs\b/g, 'south')
    .replace(/\be\b/g, 'east')
    .replace(/\bw\b/g, 'west')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPrimaryStreet(address: string, fallbackStreetName: string): string {
  const trimmed = address.trim()
  if (!trimmed) return fallbackStreetName

  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return fallbackStreetName || trimmed

  if (/^\d+[a-zA-Z]?$/.test(parts[0] ?? '')) {
    return parts.slice(1).join(' ')
  }
  return fallbackStreetName || trimmed
}

function suffixRoadKindFromName(name: string): RoadKind {
  const normalized = normalizeStreetName(name)
  if (!normalized) return null
  if (normalized.endsWith(' lane')) return 'lane'
  if (normalized.endsWith(' street')) return 'street'
  return null
}

function isBikeOrPedestrianWay(
  name: string,
  className: string,
  sourceLayer: string,
): boolean {
  const joined = `${name} ${className} ${sourceLayer}`.toLowerCase()
  return /(cycleway|bike[\s_-]?lane|bikeway|greenway|shared[\s_-]?use|multi[\s_-]?use|footway|sidewalk|pedestrian|crossing|steps|\bpath\b)/.test(
    joined,
  )
}

function toRingEdges(coordinates: Position[]): EdgeAnalysis[] {
  const edges: EdgeAnalysis[] = []
  if (coordinates.length < 2) return edges

  const lastIndex = coordinates.length - 1
  for (let index = 0; index < lastIndex; index += 1) {
    const start = coordinates[index]
    const end = coordinates[index + 1]
    if (!start || !end) continue

    const midpoint: Position = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    const lengthMeters = distance(point(start), point(end), { units: 'meters' })
    edges.push({
      index,
      start,
      end,
      midpoint,
      lengthMeters,
      type: 'Side',
      roadKind: null,
      roadName: '',
      roadClass: '',
      roadDistanceMeters: null,
      orientationDiffDeg: null,
      isRoadAdjacent: false,
      debug: 'No road candidate found.',
    })
  }

  return edges
}

function isLineGeometry(geometry: unknown): boolean {
  if (!geometry || typeof geometry !== 'object') return false
  const type = (geometry as { type?: unknown }).type
  return type === 'LineString' || type === 'MultiLineString'
}

function readStringProperty(
  properties: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = properties[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return ''
}

function toPosition(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lon = Number(value[0])
  const lat = Number(value[1])
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  return [lon, lat]
}

function normalizeLine(rawLine: unknown): Position[] {
  if (!Array.isArray(rawLine)) return []
  const coordinates: Position[] = []
  for (const coordinate of rawLine) {
    const position = toPosition(coordinate)
    if (position) coordinates.push(position)
  }
  return coordinates
}

function extractLineCollections(geometry: GeoJSONFeature['geometry']): Position[][] {
  if (!geometry || typeof geometry !== 'object') return []

  if (geometry.type === 'LineString') {
    const line = normalizeLine(geometry.coordinates)
    return line.length >= 2 ? [line] : []
  }

  if (geometry.type === 'MultiLineString') {
    if (!Array.isArray(geometry.coordinates)) return []
    return geometry.coordinates
      .map((line) => normalizeLine(line))
      .filter((line) => line.length >= 2)
  }

  return []
}

function toRoadCandidate(feature: GeoJSONFeature): RoadCandidate | null {
  if (!isLineGeometry(feature.geometry)) return null

  const properties = (feature.properties ?? {}) as Record<string, unknown>
  const name = readStringProperty(properties, ['name', 'name_en', 'streetname', 'ref'])
  const className = readStringProperty(properties, ['class', 'type', 'road_class', 'kind'])
  const sourceLayer = feature.sourceLayer ?? ''
  const joined = `${name} ${className} ${sourceLayer}`.toLowerCase()
  const classJoined = `${className} ${sourceLayer}`.toLowerCase()

  const looksRoadLike =
    /(road|street|motorway|residential|service|highway|primary|secondary|tertiary|trunk|avenue|boulevard|lane|alley)/.test(
      joined,
    )
  if (!looksRoadLike) return null
  // Prevent bike/ped/path vectors from being treated as parcel-adjacent roads.
  if (isBikeOrPedestrianWay(name, className, sourceLayer)) return null

  const lines = extractLineCollections(feature.geometry)
  if (lines.length === 0) return null

  const suffixKind = suffixRoadKindFromName(name)
  const normalizedName = normalizeStreetName(name)
  const explicitLaneName = /\b(lane|alley|alleyway)\b/.test(normalizedName)
  const explicitStreetName =
    /\b(street|avenue|road|drive|boulevard|highway|parkway|way|place|court|crescent|trail|terrace|connector)\b/.test(
      normalizedName,
    )
  const laneLikeClass = /(lane|alley|driveway|access)/.test(classJoined)
  const serviceClass = /\bservice\b/.test(classJoined)
  const laneLike = explicitLaneName || laneLikeClass || (serviceClass && !explicitStreetName)

  let kind: Exclude<RoadKind, null>
  if (suffixKind === 'lane') {
    kind = 'lane'
  } else if (suffixKind === 'street') {
    kind = 'street'
  } else {
    kind = laneLike ? 'lane' : 'street'
  }

  return {
    name,
    kind,
    className,
    sourceLayer,
    lines,
  }
}

function uniqueCandidates(candidates: RoadCandidate[]): RoadCandidate[] {
  const seen = new Set<string>()
  const output: RoadCandidate[] = []

  for (const candidate of candidates) {
    const key = `${candidate.name.toLowerCase()}|${candidate.className.toLowerCase()}|${candidate.kind}|${candidate.sourceLayer.toLowerCase()}|${candidate.lines.length}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(candidate)
  }

  return output
}

function bearingDegrees(start: Position, end: Position): number {
  const result = bearing(point(start), point(end))
  return Number.isFinite(result) ? result : 0
}

function parallelOrientationDiffDeg(a: number, b: number): number {
  const aNorm = ((a % 360) + 360) % 360
  const bNorm = ((b % 360) + 360) % 360
  const rawDiff = Math.abs(aNorm - bNorm)
  const wrappedDiff = rawDiff > 180 ? 360 - rawDiff : rawDiff
  return wrappedDiff > 90 ? 180 - wrappedDiff : wrappedDiff
}

function metersPerPixel(latitude: number, zoom: number): number {
  const earthCircumferenceMeters = 40075016.686
  return (
    (earthCircumferenceMeters * Math.cos((latitude * Math.PI) / 180)) /
    Math.pow(2, zoom + 8)
  )
}

function edgeQueryPaddingPx(map: MapboxMap, edge: EdgeAnalysis): number {
  const mpp = metersPerPixel(edge.midpoint[1], map.getZoom())
  if (!Number.isFinite(mpp) || mpp <= 0) return MIN_QUERY_PADDING_PX

  const targetPadding = Math.ceil(EDGE_QUERY_BUFFER_METERS / mpp)
  return Math.max(
    MIN_QUERY_PADDING_PX,
    Math.min(MAX_QUERY_PADDING_PX, targetPadding),
  )
}

function evaluateRoadCandidateForEdge(
  edge: EdgeAnalysis,
  candidate: RoadCandidate,
): EvaluatedRoadCandidate | null {
  const midpointFeature = point(edge.midpoint)
  const edgeBearing = bearingDegrees(edge.start, edge.end)

  let bestDistance = Number.POSITIVE_INFINITY
  let bestOrientation = Number.POSITIVE_INFINITY
  let foundSegment = false

  for (const line of candidate.lines) {
    for (let index = 0; index < line.length - 1; index += 1) {
      const segmentStart = line[index]
      const segmentEnd = line[index + 1]
      if (!segmentStart || !segmentEnd) continue
      const segmentLine = lineString([segmentStart, segmentEnd])
      const segmentDistance = pointToLineDistance(midpointFeature, segmentLine, {
        units: 'meters',
      })
      const segmentBearing = bearingDegrees(segmentStart, segmentEnd)
      const orientationDiff = parallelOrientationDiffDeg(edgeBearing, segmentBearing)
      const score = segmentDistance + orientationDiff * 0.45

      const bestScore = bestDistance + bestOrientation * 0.45
      if (score < bestScore) {
        bestDistance = segmentDistance
        bestOrientation = orientationDiff
      }
      foundSegment = true
    }
  }

  if (!foundSegment) return null

  const distanceThreshold =
    candidate.kind === 'lane'
      ? LANE_PROXIMITY_THRESHOLD_METERS
      : ROAD_PROXIMITY_THRESHOLD_METERS
  const orientationThreshold =
    candidate.kind === 'lane'
      ? LANE_ORIENTATION_THRESHOLD_DEG
      : ROAD_ORIENTATION_THRESHOLD_DEG

  return {
    ...candidate,
    distanceMeters: bestDistance,
    orientationDiffDeg: bestOrientation,
    score: bestDistance + bestOrientation * 0.45,
    isAdjacent: bestDistance <= distanceThreshold && bestOrientation <= orientationThreshold,
  }
}

function queryRoadCandidatesForEdge(map: MapboxMap, edge: EdgeAnalysis): RoadCandidate[] {
  const startPx = map.project(edge.start)
  const endPx = map.project(edge.end)
  const paddingPx = edgeQueryPaddingPx(map, edge)

  const queryGeometry: [[number, number], [number, number]] = [
    [
      Math.min(startPx.x, endPx.x) - paddingPx,
      Math.min(startPx.y, endPx.y) - paddingPx,
    ],
    [
      Math.max(startPx.x, endPx.x) + paddingPx,
      Math.max(startPx.y, endPx.y) + paddingPx,
    ],
  ]

  const features = map.queryRenderedFeatures(queryGeometry)
  const candidates = features
    .map((feature) => toRoadCandidate(feature))
    .filter((candidate): candidate is RoadCandidate => candidate !== null)

  return uniqueCandidates(candidates)
}

function findEvaluatedRoadCandidatesForEdge(
  map: MapboxMap,
  edge: EdgeAnalysis,
): EvaluatedRoadCandidate[] {
  const candidates = queryRoadCandidatesForEdge(map, edge)
  if (candidates.length === 0) return []

  const evaluated: EvaluatedRoadCandidate[] = []
  for (const candidate of candidates) {
    const match = evaluateRoadCandidateForEdge(edge, candidate)
    if (match) evaluated.push(match)
  }

  evaluated.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return a.distanceMeters - b.distanceMeters
  })
  return evaluated
}

function applyMatchToEdge(edge: EdgeAnalysis, match: EvaluatedRoadCandidate): void {
  edge.roadName = match.name
  edge.roadClass = match.className
  edge.roadDistanceMeters = match.distanceMeters
  edge.orientationDiffDeg = match.orientationDiffDeg
  edge.isRoadAdjacent = match.isAdjacent
  edge.roadKind = match.isAdjacent ? match.kind : null
  edge.debug = match.isAdjacent
    ? `Adjacent to ${match.kind} "${match.name || 'unnamed'}" at ${match.distanceMeters.toFixed(1)}m, orientation diff ${match.orientationDiffDeg.toFixed(1)}deg.`
    : `Nearest road "${match.name || 'unnamed'}" at ${match.distanceMeters.toFixed(1)}m (not adjacent threshold).`
}

type StreetRelaxMode = 'frontage' | 'flankage'

function isRelaxedStreetCandidateForMode(
  candidate: EvaluatedRoadCandidate,
  mode: StreetRelaxMode,
): boolean {
  if (candidate.kind !== 'street') return false

  if (mode === 'frontage') {
    return (
      candidate.distanceMeters <= RELAXED_FRONTAGE_STREET_DISTANCE_METERS &&
      candidate.orientationDiffDeg <= RELAXED_FRONTAGE_STREET_ORIENTATION_DEG
    )
  }

  return (
    candidate.distanceMeters <= RELAXED_FLANKAGE_STREET_DISTANCE_METERS &&
    candidate.orientationDiffDeg <= RELAXED_FLANKAGE_STREET_ORIENTATION_DEG
  )
}

function isRelaxedLaneCandidate(candidate: EvaluatedRoadCandidate): boolean {
  if (candidate.kind !== 'lane') return false
  return (
    candidate.distanceMeters <= RELAXED_LANE_DISTANCE_METERS &&
    candidate.orientationDiffDeg <= RELAXED_LANE_ORIENTATION_DEG
  )
}

function firstAdjacentStreet(
  candidates: EvaluatedRoadCandidate[],
  allowRelaxed = false,
  relaxMode: StreetRelaxMode = 'frontage',
): EvaluatedRoadCandidate | null {
  for (const candidate of candidates) {
    if (candidate.kind !== 'street') continue
    if (candidate.isAdjacent) return candidate
    if (allowRelaxed && isRelaxedStreetCandidateForMode(candidate, relaxMode)) {
      return candidate
    }
  }
  return null
}

function firstAdjacentLane(
  candidates: EvaluatedRoadCandidate[],
  allowRelaxed = false,
): EvaluatedRoadCandidate | null {
  for (const candidate of candidates) {
    if (candidate.kind !== 'lane') continue
    if (candidate.isAdjacent) return candidate
    if (allowRelaxed && isRelaxedLaneCandidate(candidate)) return candidate
  }
  return null
}

function firstAdjacentStreetByName(
  candidates: EvaluatedRoadCandidate[],
  normalizedStreet: string,
  allowRelaxed = false,
  relaxMode: StreetRelaxMode = 'frontage',
): EvaluatedRoadCandidate | null {
  if (!normalizedStreet) return null
  for (const candidate of candidates) {
    if (candidate.kind !== 'street') continue
    if (normalizeStreetName(candidate.name) !== normalizedStreet) continue
    if (candidate.isAdjacent) return candidate
    if (allowRelaxed && isRelaxedStreetCandidateForMode(candidate, relaxMode)) {
      return candidate
    }
  }
  return null
}

function firstDifferentStreetCandidate(
  candidates: EvaluatedRoadCandidate[],
  normalizedBaseStreet: string,
  allowRelaxed = false,
): EvaluatedRoadCandidate | null {
  for (const candidate of candidates) {
    if (candidate.kind !== 'street') continue
    const normalizedCandidateStreet = normalizeStreetName(candidate.name)
    if (!normalizedCandidateStreet) continue
    if (
      normalizedBaseStreet &&
      normalizedCandidateStreet === normalizedBaseStreet
    ) {
      continue
    }
    if (candidate.isAdjacent) return candidate
    if (allowRelaxed && isRelaxedStreetCandidateForMode(candidate, 'flankage')) {
      return candidate
    }
  }
  return null
}

function findOppositeEdgeIndex(edges: EdgeAnalysis[], frontageIndex: number): number {
  const frontage = edges[frontageIndex]
  if (!frontage) return -1

  const frontageBearing = bearingDegrees(frontage.start, frontage.end)
  const frontageLine = lineString([frontage.start, frontage.end])

  type OppositeCandidate = {
    index: number
    orientationDiffDeg: number
    perpendicularDistanceMeters: number
    midpointDistanceMeters: number
    score: number
  }
  const candidates: OppositeCandidate[] = []

  for (const edge of edges) {
    if (edge.index === frontageIndex) continue

    const orientationDiffDeg = parallelOrientationDiffDeg(
      frontageBearing,
      bearingDegrees(edge.start, edge.end),
    )
    const perpendicularDistanceMeters = pointToLineDistance(
      point(edge.midpoint),
      frontageLine,
      { units: 'meters' },
    )
    const midpointDistanceMeters = distance(
      point(frontage.midpoint),
      point(edge.midpoint),
      {
        units: 'meters',
      },
    )

    candidates.push({
      index: edge.index,
      orientationDiffDeg,
      perpendicularDistanceMeters,
      midpointDistanceMeters,
      score: perpendicularDistanceMeters + midpointDistanceMeters * 0.2,
    })
  }

  const chooseBestOppositeWithinOrientation = (
    maxOrientationDiffDeg: number,
  ): number => {
    const oriented = candidates.filter(
      (candidate) => candidate.orientationDiffDeg <= maxOrientationDiffDeg,
    )
    if (oriented.length === 0) return -1

    oriented.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score
      if (a.perpendicularDistanceMeters !== b.perpendicularDistanceMeters) {
        return b.perpendicularDistanceMeters - a.perpendicularDistanceMeters
      }
      return b.midpointDistanceMeters - a.midpointDistanceMeters
    })

    return oriented[0]?.index ?? -1
  }

  const strictOpposite = chooseBestOppositeWithinOrientation(
    OPPOSITE_EDGE_STRICT_ORIENTATION_DEG,
  )
  if (strictOpposite >= 0) return strictOpposite

  const relaxedOpposite = chooseBestOppositeWithinOrientation(
    OPPOSITE_EDGE_RELAXED_ORIENTATION_DEG,
  )
  if (relaxedOpposite >= 0) return relaxedOpposite

  let bestIndex = -1
  let farthestDistance = -1

  for (const edge of edges) {
    if (edge.index === frontageIndex) continue
    const d = distance(point(frontage.midpoint), point(edge.midpoint), {
      units: 'meters',
    })
    if (d > farthestDistance) {
      farthestDistance = d
      bestIndex = edge.index
    }
  }

  return bestIndex
}

function selectNearestEdgeByStreetCandidate(
  edges: EdgeAnalysis[],
  edgeMatches: Map<number, EvaluatedRoadCandidate[]>,
  options: {
    normalizedStreet?: string
    allowRelaxed: boolean
    relaxMode?: StreetRelaxMode
  },
): EdgeAnalysis | null {
  if (edges.length === 0) return null

  const relaxMode = options.relaxMode ?? 'frontage'
  const normalizedStreet = options.normalizedStreet ?? ''
  let bestEdge: EdgeAnalysis | null = null
  let bestCandidate: EvaluatedRoadCandidate | null = null

  for (const edge of edges) {
    const matches = edgeMatches.get(edge.index) ?? []
    const candidate = normalizedStreet
      ? firstAdjacentStreetByName(
          matches,
          normalizedStreet,
          options.allowRelaxed,
          relaxMode,
        )
      : firstAdjacentStreet(matches, options.allowRelaxed, relaxMode)
    if (!candidate) continue

    if (!bestEdge || !bestCandidate) {
      bestEdge = edge
      bestCandidate = candidate
      continue
    }

    const distanceDelta = candidate.distanceMeters - bestCandidate.distanceMeters
    if (distanceDelta < -EDGE_SELECTION_DISTANCE_TIE_METERS) {
      bestEdge = edge
      bestCandidate = candidate
      continue
    }
    if (distanceDelta > EDGE_SELECTION_DISTANCE_TIE_METERS) {
      continue
    }

    const lengthDelta = edge.lengthMeters - bestEdge.lengthMeters
    if (lengthDelta > EDGE_SELECTION_LENGTH_TIE_METERS) {
      bestEdge = edge
      bestCandidate = candidate
      continue
    }
    if (lengthDelta < -EDGE_SELECTION_LENGTH_TIE_METERS) {
      continue
    }

    if (candidate.orientationDiffDeg < bestCandidate.orientationDiffDeg) {
      bestEdge = edge
      bestCandidate = candidate
    }
  }

  return bestEdge
}

function determineLotType(
  hasFlankage: boolean,
  isDoubleFronting: boolean,
  oppositeEdge: EdgeAnalysis | null,
): { lotType: LotType; reason: string } {
  // Assignment priority order: Corner > Double Fronting > Standard with Lane > Standard without Lane.
  if (hasFlankage) {
    return {
      lotType: 'Corner Lot',
      reason: 'Has frontage and at least one flankage edge on a different street.',
    }
  }
  if (isDoubleFronting) {
    return {
      lotType: 'Double Fronting',
      reason: 'Frontage and opposite edge both face different streets (not lanes).',
    }
  }
  if (oppositeEdge?.isRoadAdjacent && oppositeEdge.roadKind === 'lane') {
    return {
      lotType: 'Standard with Lane',
      reason: 'Frontage present and opposite edge is adjacent to a lane/alley.',
    }
  }
  return {
    lotType: 'Standard without Lane',
    reason: 'Frontage present and opposite side is not adjacent to a lane.',
  }
}

export function analyzeParcel(
  parcel: ParcelFeature,
  map?: MapboxMap,
): ParcelAnalysis {
  const ring = parcel.geometry.coordinates[0] ?? []
  const edges = toRingEdges(ring)

  const primaryStreet = extractPrimaryStreet(
    parcel.properties.fullAddress,
    parcel.properties.streetName,
  )
  const normalizedPrimaryStreet = normalizeStreetName(primaryStreet)
  const edgeMatches = new Map<number, EvaluatedRoadCandidate[]>()

  if (map) {
    for (const edge of edges) {
      const matches = findEvaluatedRoadCandidatesForEdge(map, edge)
      edgeMatches.set(edge.index, matches)

      const defaultMatch =
        firstAdjacentStreet(matches, false, 'frontage') ??
        matches.find((candidate) => candidate.isAdjacent) ??
        matches[0]
      if (!defaultMatch) {
        edge.debug = 'No road candidate found near edge centerline.'
        continue
      }
      applyMatchToEdge(edge, defaultMatch)
    }
  }

  const strictCandidateStreetEdges = edges.filter(
    (edge) =>
      firstAdjacentStreet(edgeMatches.get(edge.index) ?? [], false, 'frontage') !==
      null,
  )
  const relaxedCandidateStreetEdges = edges.filter(
    (edge) =>
      firstAdjacentStreet(edgeMatches.get(edge.index) ?? [], true, 'frontage') !==
      null,
  )
  const candidateStreetEdges =
    strictCandidateStreetEdges.length > 0
      ? strictCandidateStreetEdges
      : relaxedCandidateStreetEdges

  let frontageEdge: EdgeAnalysis | null = null
  let frontageMatchedByPrimaryStreet = false

  if (normalizedPrimaryStreet) {
    // Frontage selection is strict-first on matching street name, then relaxed fallback.
    frontageEdge = selectNearestEdgeByStreetCandidate(edges, edgeMatches, {
      normalizedStreet: normalizedPrimaryStreet,
      allowRelaxed: false,
      relaxMode: 'frontage',
    })
    if (!frontageEdge) {
      frontageEdge = selectNearestEdgeByStreetCandidate(edges, edgeMatches, {
        normalizedStreet: normalizedPrimaryStreet,
        allowRelaxed: true,
        relaxMode: 'frontage',
      })
    }
    frontageMatchedByPrimaryStreet = frontageEdge !== null
  }

  if (!frontageEdge) {
    frontageEdge = selectNearestEdgeByStreetCandidate(
      candidateStreetEdges,
      edgeMatches,
      {
        allowRelaxed: false,
        relaxMode: 'frontage',
      },
    )
  }

  if (!frontageEdge) {
    frontageEdge = selectNearestEdgeByStreetCandidate(
      candidateStreetEdges,
      edgeMatches,
      {
        allowRelaxed: true,
        relaxMode: 'frontage',
      },
    )
  }

  if (!frontageEdge && edges.length > 0) {
    frontageEdge = edges.reduce((best, current) =>
      current.lengthMeters > best.lengthMeters ? current : best,
    )
  }

  const frontageIndex = frontageEdge?.index ?? -1
  if (frontageEdge) {
    frontageEdge.type = 'Frontage'
    const frontageMatches = edgeMatches.get(frontageEdge.index) ?? []
    const frontageStreetMatch =
      firstAdjacentStreetByName(
        frontageMatches,
        normalizedPrimaryStreet,
        true,
        'frontage',
      ) ?? firstAdjacentStreet(frontageMatches, true, 'frontage')
    if (frontageStreetMatch) {
      applyMatchToEdge(frontageEdge, frontageStreetMatch)
      frontageEdge.isRoadAdjacent = true
      frontageEdge.roadKind = 'street'
    }
  }

  const oppositeIndex =
    frontageIndex >= 0 ? findOppositeEdgeIndex(edges, frontageIndex) : -1
  const oppositeEdge = oppositeIndex >= 0 ? edges[oppositeIndex] ?? null : null
  const frontageStreetNormalized =
    normalizeStreetName(frontageEdge?.roadName ?? '') || normalizedPrimaryStreet

  let isDoubleFronting = false
  if (
    frontageEdge &&
    oppositeEdge &&
    edgeMatches.has(oppositeEdge.index)
  ) {
    const oppositeMatches = edgeMatches.get(oppositeEdge.index) ?? []
    const oppositeStreetCandidate = firstAdjacentStreet(
      oppositeMatches,
      true,
      'frontage',
    )
    const oppositeStreet = normalizeStreetName(oppositeStreetCandidate?.name ?? '')
    if (
      oppositeStreetCandidate &&
      oppositeStreet &&
      frontageStreetNormalized &&
      oppositeStreet !== frontageStreetNormalized
    ) {
      isDoubleFronting = true
      oppositeEdge.type = 'Frontage'
      applyMatchToEdge(oppositeEdge, oppositeStreetCandidate)
      oppositeEdge.isRoadAdjacent = true
      oppositeEdge.roadKind = 'street'
    }
  }

  const baseFrontageStreet =
    normalizeStreetName(frontageEdge?.roadName ?? '') || normalizedPrimaryStreet
  const applyFlankage = (allowRelaxed: boolean): number => {
    let count = 0
    for (const edge of edges) {
      if (edge.index === frontageIndex) continue
      if (edge.index === oppositeIndex) continue

      const matches = edgeMatches.get(edge.index) ?? []
      const flankageStreetCandidate = firstDifferentStreetCandidate(
        matches,
        baseFrontageStreet,
        allowRelaxed,
      )
      if (!flankageStreetCandidate) continue

      edge.type = 'Flankage'
      applyMatchToEdge(edge, flankageStreetCandidate)
      edge.isRoadAdjacent = true
      edge.roadKind = 'street'
      count += 1
    }
    return count
  }

  let flankageCount = applyFlankage(false)
  let usedRelaxedFlankage = false
  if (flankageCount === 0) {
    const relaxedCount = applyFlankage(true)
    if (relaxedCount > 0) {
      flankageCount = relaxedCount
      usedRelaxedFlankage = true
    }
  }

  let usedRelaxedLane = false
  if (oppositeEdge && !isDoubleFronting) {
    const oppositeMatches = edgeMatches.get(oppositeEdge.index) ?? []
    const oppositeLane = firstAdjacentLane(oppositeMatches, true)
    if (oppositeLane) {
      oppositeEdge.type = 'Rear Lane'
      applyMatchToEdge(oppositeEdge, oppositeLane)
      oppositeEdge.isRoadAdjacent = true
      oppositeEdge.roadKind = 'lane'
      if (!oppositeLane.isAdjacent) {
        oppositeEdge.debug = `${oppositeEdge.debug} (relaxed lane fallback)`
        usedRelaxedLane = true
      }
    } else {
      oppositeEdge.type = 'Rear'
    }
  }

  const laneDetectedOnOpposite =
    oppositeEdge?.isRoadAdjacent === true && oppositeEdge.roadKind === 'lane'
  const hasReliableFlankage =
    flankageCount > 0 && !(usedRelaxedFlankage && laneDetectedOnOpposite)

  const { lotType, reason } = determineLotType(
    hasReliableFlankage,
    isDoubleFronting,
    oppositeEdge,
  )

  let finalReason = reason
  if (lotType === 'Corner Lot' && usedRelaxedFlankage) {
    finalReason = `${reason} Secondary street detected using relaxed flankage fallback.`
  }
  if (
    lotType === 'Standard with Lane' &&
    usedRelaxedFlankage &&
    flankageCount > 0
  ) {
    finalReason = `${reason} Weak flankage evidence was ignored because a rear lane was detected.`
  }
  if (lotType === 'Standard with Lane' && usedRelaxedLane) {
    finalReason = `${finalReason} Lane detected using relaxed rear-lane fallback.`
  }

  let confidence: 'high' | 'medium' | 'low' = 'high'
  if (!frontageMatchedByPrimaryStreet) {
    confidence = candidateStreetEdges.length > 0 ? 'medium' : 'low'
  }
  if (lotType === 'Double Fronting' && !frontageMatchedByPrimaryStreet) {
    confidence = 'medium'
  }
  if (usedRelaxedFlankage || usedRelaxedLane) {
    confidence = confidence === 'low' ? 'low' : 'medium'
  }

  const parcelFeature: Feature<Polygon> = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: parcel.geometry.coordinates,
    },
    properties: {},
  }
  const parcelArea = area(parcelFeature)

  return {
    areaM2: parcelArea,
    primaryStreet,
    lotType,
    reason: finalReason,
    confidence,
    edges,
  }
}

export function edgeColor(edgeType: EdgeType): string {
  switch (edgeType) {
    case 'Frontage':
      return '#d62828'
    case 'Flankage':
      return '#f77f00'
    case 'Rear Lane':
      return '#2a9d8f'
    case 'Rear':
      return '#264653'
    case 'Side':
      return '#6c757d'
    default:
      return '#6c757d'
  }
}
