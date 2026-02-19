import type { ParcelAnalysis, ParcelFeature } from '../../types/parcel'

export interface InfoCardProps {
  selectedParcel: ParcelFeature | null
  analysis: ParcelAnalysis | null
}

function formatArea(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString()} m²`
}

function getConfidenceClasses(confidence: string): string {
  const lower = confidence.toLowerCase()
  if (lower.includes('high')) return 'bg-ok/10 text-ok'
  if (lower.includes('med') || lower.includes('mod')) return 'bg-warn/10 text-warn'
  return 'bg-error/10 text-error'
}

const INFO_ROWS = [
  'border-b border-border',
  'border-b border-border',
  'border-b border-border',
  'border-b border-border',
  '', // last row — no border
]

export function InfoCard({ selectedParcel, analysis }: InfoCardProps) {
  if (!selectedParcel || !analysis) {
    return (
      <section className="panel">
        <h2 className="text-[0.7rem] font-semibold tracking-[0.06em] uppercase text-muted-soft mb-3">
          Parcel
        </h2>
        <p className="text-muted text-sm leading-relaxed">
          Select a parcel on the map or search an address.
        </p>
      </section>
    )
  }

  const rows = [
    {
      label: 'Address',
      value: <span className="font-semibold text-foreground text-right break-words">{selectedParcel.properties.fullAddress}</span>,
    },
    {
      label: 'Area',
      value: <span className="font-semibold text-foreground">{formatArea(analysis.areaM2)}</span>,
    },
    {
      label: 'Primary Street',
      value: <span className="font-semibold text-foreground">{analysis.primaryStreet || '—'}</span>,
    },
    {
      label: 'Lot Type',
      value: (
        <span className="inline-block px-2 py-0.5 rounded-full text-[0.76rem] font-semibold bg-brand/10 text-brand">
          {analysis.lotType}
        </span>
      ),
    },
    {
      label: 'Confidence',
      value: (
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-[0.76rem] font-semibold ${getConfidenceClasses(analysis.confidence)}`}
        >
          {analysis.confidence}
        </span>
      ),
    },
  ]

  return (
    <section className="panel">
      <h2 className="text-[0.7rem] font-semibold tracking-[0.06em] uppercase text-muted-soft mb-3">
        Parcel Info
      </h2>
      <div key={selectedParcel.properties.id} className="animate-fade-in-up flex flex-col">
        {rows.map(({ label, value }, i) => (
          <div
            key={label}
            className={`flex justify-between items-baseline gap-3 py-2 text-[0.87rem] ${INFO_ROWS[i]}`}
          >
            <span className="text-muted whitespace-nowrap shrink-0">{label}</span>
            {value}
          </div>
        ))}
      </div>
    </section>
  )
}
