// A segment's members, live from Zero. Which columns show, which one is drawn as a bar,
// and the default sort all come from `display` in project.yaml.
import { useQuery } from '@rocicorp/zero/react'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { Fragment, useState } from 'react'
import { DISPLAY, PROJECT } from '~/generated/project'
import { SORT_COLUMNS, queries } from '~/zero/queries'
import { EntityDrawer } from '~/components/overview/EntityDrawer'
import { count, formatScore, isAttribute, scoreLabel } from '~/components/ui/format'
import type { Segment } from '~/components/overview/Segments'
import { Button, Skeleton, Th, cx } from '~/components/ui'

type SortCol = (typeof SORT_COLUMNS)[number]
type Row = Record<string, unknown>
const isSortable = (c: string | null | undefined): c is SortCol => !!c && (SORT_COLUMNS as readonly string[]).includes(c)

const COLUMNS = DISPLAY.columns as readonly string[]
const HIGHLIGHT = DISPLAY.highlight as string | null
const PAGE = 15

export function RatioBar({ value }: { value?: number | null }) {
  if (value == null) return <span className="text-faint">—</span>
  const v = Math.max(0, Math.min(1, value))
  const tone = v > 0.7 ? 'bg-danger' : v > 0.4 ? 'bg-warning' : 'bg-success'
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-subtle">
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${Math.max(2, Math.round(v * 100))}%` }} />
      </div>
      <span className="num w-9 text-[12px] text-muted">{Math.round(v * 100)}%</span>
    </div>
  )
}

export function MembersTable({ segment }: { segment: Segment }) {
  const [sortBy, setSortBy] = useState<SortCol>((isSortable(DISPLAY.defaultSort) ? DISPLAY.defaultSort : SORT_COLUMNS[0]) as SortCol)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(DISPLAY.sortDir as 'asc' | 'desc')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<string | number | null>(null)
  const [rows, details] = useQuery(
    queries.scores.members({ rules: segment.rules as never, match: segment.match, sortBy, sortDir, limit }),
  )
  const loading = rows.length === 0 && details.type !== 'complete'

  const sort = (col: string) => {
    if (!isSortable(col)) return
    if (col === sortBy) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else {
      setSortBy(col)
      setSortDir(isAttribute(col) ? 'asc' : 'desc')
    }
  }
  const header = (col: string, align?: 'right') => (
    <Th align={align}>
      <button onClick={() => sort(col)} disabled={!isSortable(col)}
        className={cx('inline-flex items-center gap-1 hover:text-fg', sortBy === col && 'text-fg')}>
        {scoreLabel(col)}
        {sortBy === col && (sortDir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </Th>
  )
  const exportCsv = () => {
    const cols = [PROJECT.key, ...COLUMNS, ...(HIGHLIGHT ? [HIGHLIGHT] : [])]
    const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const csv = [cols.join(','), ...(rows as Row[]).map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${segment.name}.csv`
    a.click()
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold">{segment.label}</h2>
            <span className="num text-[12px] text-faint">{count(segment.size)}</span>
          </div>
          {segment.description && <p className="truncate text-[12px] text-muted">{segment.description}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className={cx('size-1.5 rounded-full', details.type === 'complete' ? 'bg-success' : details.type === 'error' ? 'bg-danger' : 'animate-pulse bg-warning')} />
            {details.type === 'complete' ? 'Live' : details.type === 'error' ? 'Sync error' : 'Syncing'}
          </span>
          <Button size="sm" icon={<Download />} onClick={exportCsv} disabled={!rows.length}>Export</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="border-b border-line bg-subtle/60 text-left">
            <tr>
              <Th>{PROJECT.entity.charAt(0).toUpperCase() + PROJECT.entity.slice(1)}</Th>
              {COLUMNS.map((c) => <Fragment key={c}>{header(c, isAttribute(c) ? undefined : 'right')}</Fragment>)}
              {HIGHLIGHT && header(HIGHLIGHT)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}><td colSpan={COLUMNS.length + 2} className="px-4 py-2.5"><Skeleton className="h-4 w-full" /></td></tr>
            ))}
            {(rows as Row[]).map((r) => {
              const key = r[PROJECT.key] as string | number
              return (
                <tr key={String(key)} onClick={() => setOpen(key)} className="h-10 cursor-pointer transition-colors hover:bg-hover">
                  <td className="num px-3 pl-4 font-mono text-[12px] text-muted">{String(key)}</td>
                  {COLUMNS.map((c) => (
                    <td key={c} className={cx('num whitespace-nowrap px-3', isAttribute(c) ? 'text-muted' : 'text-right')}>{formatScore(c, r[c])}</td>
                  ))}
                  {HIGHLIGHT && <td className="px-3 pr-4"><RatioBar value={r[HIGHLIGHT] as number | null} /></td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && details.type === 'complete' && (
        <p className="px-4 py-8 text-center text-[13px] text-muted">No {PROJECT.entityLabel.toLowerCase()} in this segment.</p>
      )}
      {rows.length > 0 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2">
          <span className="num text-[12px] text-faint">Showing {count(rows.length)} of {count(segment.size)}</span>
          {rows.length >= limit && limit < 500 && (
            <Button size="sm" variant="ghost" onClick={() => setLimit(Math.min(limit + PAGE * 3, 500))}>Show more</Button>
          )}
        </div>
      )}
      {open != null && <EntityDrawer entityKey={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
