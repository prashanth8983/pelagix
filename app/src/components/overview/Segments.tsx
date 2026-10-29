import { useQuery } from '@rocicorp/zero/react'
import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useMe } from '~/lib/session'
import { queries } from '~/zero/queries'
import { count } from '~/components/ui/format'
import { Card, Skeleton, cx } from '~/components/ui'
import type { Rule } from '~/zero/schema'

export type Segment = { name: string; label: string; description?: string; match: 'all' | 'any'; rules: Rule[]; size: number }

/** Every segment as a row with its size and share; picking one scopes the members table. */
export function SegmentList({ selected, onSelect }: { selected: string; onSelect: (s: Segment) => void }) {
  const [rows, details] = useQuery(queries.segments.all())
  const { can } = useMe()
  const toSegment = (s: (typeof rows)[number]): Segment =>
    ({ name: s.name, label: s.label ?? s.name, description: s.description ?? undefined, match: s.match === 'any' ? 'any' : 'all', rules: s.rules ?? [], size: s.size ?? 0 })

  // Keep the selected segment's size and rules in step with the live row (a re-score changes them).
  const live = rows.find((s) => s.name === selected)
  useEffect(() => {
    if (live) onSelect(toSegment(live))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.size, live?.label, live?.match, JSON.stringify(live?.rules)])

  const total = rows.find((s) => !s.rules?.length)?.size ?? Math.max(0, ...rows.map((s) => s.size ?? 0))
  return (
    <Card
      title="Segments"
      actions={can('editor') && <Link to="/configure/segments" className="text-[12px] text-muted hover:text-fg">Edit</Link>}
      padded={false}
    >
      {details.type === 'error' ? (
        <p className="p-4 text-[13px] text-danger">Sync error: {details.error.message}</p>
      ) : rows.length === 0 ? (
        <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : (
        <ul role="listbox" aria-label="Segments" className="p-1.5">
          {rows.map((s) => {
            const active = s.name === selected
            const share = total ? ((s.size ?? 0) / total) * 100 : 0
            return (
              <li key={s.name}>
                <button
                  role="option"
                  aria-selected={active}
                  title={s.description ?? s.filter ?? undefined}
                  onClick={() => onSelect(toSegment(s))}
                  className={cx('block w-full rounded-md px-2.5 py-2 text-left transition-colors', active ? 'bg-accent-subtle' : 'hover:bg-hover')}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className={cx('truncate text-[13px]', active ? 'font-medium text-fg' : 'text-muted')}>{s.label}</span>
                    <span className="num shrink-0 text-[13px] font-medium">{count(s.size)}</span>
                  </span>
                  <span className="mt-1.5 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-subtle">
                      <span className={cx('block h-full rounded-full', active ? 'bg-accent' : 'bg-line-strong')} style={{ width: `${Math.max(1, share)}%` }} />
                    </span>
                    <span className="num w-9 text-right text-[11px] text-faint">{share < 1 && share > 0 ? share.toFixed(1) : Math.round(share)}%</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
