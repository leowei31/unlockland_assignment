import type { ParcelAnalysis, ParcelFeature } from '../../types/parcel'

export interface DebugPanelProps {
  selectedParcel: ParcelFeature | null
  analysis: ParcelAnalysis | null
}

export function DebugPanel({ selectedParcel, analysis }: DebugPanelProps) {
  if (!selectedParcel || !analysis) {
    return (
      <section className="panel animate-fade-in">
        <h2 className="text-[0.7rem] font-semibold tracking-[0.06em] uppercase text-muted-soft mb-3">
          Debug
        </h2>
        <p className="text-muted text-sm leading-relaxed">No parcel selected.</p>
      </section>
    )
  }

  return (
    <section className="panel animate-fade-in">
      <h2 className="text-[0.7rem] font-semibold tracking-[0.06em] uppercase text-muted-soft mb-3">
        Debug Diagnostics
      </h2>

      <div className="flex flex-col gap-1 mb-3 text-[0.82rem] text-muted leading-relaxed">
        <p>
          <strong className="text-foreground font-semibold">ID:</strong>{' '}
          {selectedParcel.properties.id}
        </p>
        <p>
          <strong className="text-foreground font-semibold">Reason:</strong> {analysis.reason}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 max-h-[200px] overflow-auto">
        {analysis.edges.map((edge) => (
          <div
            key={edge.index}
            className="text-[0.76rem] font-mono bg-surface-hover border border-border rounded-lg px-2.5 py-1.5 leading-relaxed text-muted"
          >
            <strong className="text-foreground">Edge {edge.index + 1}</strong> {edge.type} | Road:{' '}
            {edge.roadName || 'N/A'} ({edge.roadKind ?? 'none'}) | Adjacent:{' '}
            {edge.isRoadAdjacent ? 'yes' : 'no'}
            {typeof edge.roadDistanceMeters === 'number'
              ? ` | Dist: ${edge.roadDistanceMeters.toFixed(1)}m`
              : ''}
            {typeof edge.orientationDiffDeg === 'number'
              ? ` | Angle: ${edge.orientationDiffDeg.toFixed(1)}°`
              : ''}
            <div>{edge.debug}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
