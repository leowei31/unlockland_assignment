import type { FeatureCollection, LineString } from 'geojson'
import type { ParcelAnalysis } from '../../types/parcel'

export type EdgeLineFeatureCollection = FeatureCollection<
  LineString,
  { edgeType: string; label: string }
>

export function toEdgeFeatureCollection(
  analysis: ParcelAnalysis | null,
): EdgeLineFeatureCollection {
  if (!analysis) {
    return {
      type: 'FeatureCollection',
      features: [],
    }
  }

  return {
    type: 'FeatureCollection',
    features: analysis.edges.map((edge) => ({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [edge.start, edge.end],
      },
      properties: {
        edgeType: edge.type,
        label: `${edge.index + 1} ${edge.type}`,
      },
    })),
  }
}
