import { useQuery } from '@rocicorp/zero/react'
import { useEffect } from 'react'
import { queries } from '~/zero/queries'
import { count } from './format'
import { Skeleton, cx } from './ui'
import type { Rule } from '~/zero/schema'

export type Segment = { name: string; label: string; description?: string; rules: Rule[]; size: number }

export function SegmentCards({ selected, onSelect }: { selected: string; onSelect: (s: Segment) => void }) {
  const [rows, details] = useQuery(queries.segments.all())
  const toSegment = (s: (typeof rows)[number]): Segment =>
    ({ name: s.name, label: s.label ?? s.name, description: s.description ?? undefined, rules: s.rules ?? [], size: s.size ?? 0 })

  // Keep the selected segment's size and rules in step with the live row (a re-score changes them).
  const live = rows.find((s) => s.name === selected)
  useEffect(() => {
    if (live) onSelect(toSegment(live))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.size, live?.label, JSON.stringify(live?.rules)])

  if (details.type === 'error') {
    return <p className="text-[13px] text-danger">Sync error: {details.error.message}</p>
  }
  // gap-px over a line-colored background draws the dividers between cells
  const grid = 'grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 xl:grid-cols-6 [&>*]:bg-surface'
  if (rows.length === 0) {
    return (
      <div className={grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 p-4"><Skeleton className="h-3 w-20" /><Skeleton className="h-6 w-16" /></div>
        ))}
      </div>
    )
  }

  const total = rows.find((s) => !s.rules?.length)?.size ?? 0
  return (
    <div className={grid} role="tablist" aria-label="Segments">
      {rows.map((s) => {
        const active = s.name === selected
        const share = total && s.rules?.length ? ((s.size ?? 0) / total) * 100 : null
        return (
          <button
            key={s.name}
            role="tab"
            aria-selected={active}
            title={s.description ?? s.filter ?? undefined}
            onClick={() => onSelect(toSegment(s))}
            className={cx('relative px-4 py-3.5 text-left transition-colors hover:!bg-hover', active && '!bg-hover')}
          >
            {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            <div className="truncate text-[12px] text-muted">{s.label}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="num text-[22px] font-semibold tracking-tight">{count(s.size)}</span>
              {share != null && <span className="num text-[12px] text-faint">{share < 1 ? share.toFixed(1) : Math.round(share)}%</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}
