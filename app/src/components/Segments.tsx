import { useQuery } from '@rocicorp/zero/react'
import { queries } from '~/zero/queries'
import { count } from './format'
import type { Rule } from '~/zero/schema'

export type Segment = { name: string; label: string; rules: Rule[]; size: number }

export function SegmentCards({ selected, onSelect }: { selected: string; onSelect: (s: Segment) => void }) {
  const [rows, details] = useQuery(queries.segments.all())

  if (details.type === 'error') {
    return <p className="text-sm text-risk">Sync error: {details.error.message}</p>
  }
  if (rows.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[84px] animate-pulse rounded-xl border border-line bg-white" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {rows.map((s) => {
        const active = s.name === selected
        return (
          <button
            key={s.name}
            onClick={() => onSelect({ name: s.name, label: s.label ?? s.name, rules: s.rules ?? [], size: s.size ?? 0 })}
            className={`rounded-xl border bg-white px-4 py-3 text-left transition ${
              active ? 'border-accent ring-2 ring-accent/15' : 'border-line hover:border-gray-300'
            }`}
          >
            <div className="text-[13px] text-muted">{s.label}</div>
            <div className="num mt-1 text-2xl font-semibold tracking-tight">{count(s.size)}</div>
          </button>
        )
      })}
    </div>
  )
}
