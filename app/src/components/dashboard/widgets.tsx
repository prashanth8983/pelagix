// Dashboard widgets: each one fetches its own data through the guarded server functions
// and draws it in a card. Nothing here writes anything.
//
// Layout: the page grid has three columns and fixed 120px rows. KPI tiles (metric, segment)
// take one row, charts and tables three, so cards of the same kind always line up and the
// grid can pack small tiles into the holes beside a large one.
import { useQuery } from '@rocicorp/zero/react'
import { useServerFn } from '@tanstack/react-start'
import { ArrowDownRight, ArrowUpRight, Code2, Download, Maximize2, RefreshCw, X } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell as ChartCell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PROJECT, SCORES } from '~/generated/project'
import type { Cell, QueryResult } from '~/lib/types'
import { distribution, runQuery } from '~/server/config'
import type { ChartKind, Widget } from '~/server/dashboards'
import { queries } from '~/zero/queries'
import { count, formatScore, formatValue, scoreLabel, short } from '~/components/ui/format'
import { ResultView, SERIES, axisTick, tooltipStyle } from '~/components/sql/ResultView'
import { SqlBlock } from '~/components/sql/Sql'
import { Skeleton, cx } from '~/components/ui'

// ---------- page context ----------

/** Set by the dashboard page: `tick` bumps to refresh every widget, `expand` opens one full size. */
type Dash = { tick: number; editing?: boolean; expand?: (w: Widget) => void }
const DashCtx = createContext<Dash>({ tick: 0 })
export const DashboardContext = DashCtx.Provider

/** Load on mount and whenever the page asks for a refresh; keeps the old data while reloading. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const { tick } = useContext(DashCtx)
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: undefined }))
    load().then((data) => setState({ data, loading: false })).catch((e) => setState({ loading: false, error: (e as Error).message }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  useEffect(run, [run])
  return { ...state, refresh: run }
}

// ---------- formatting ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/
const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const fullDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const compactUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

/** Axis labels: ISO dates read as "Oct 25", everything else as is. */
const xTick = (v: unknown) => (typeof v === 'string' && ISO_DATE.test(v) ? monthYear.format(new Date(v)) : String(v))
const xLabel = (v: unknown) => (typeof v === 'string' && ISO_DATE.test(v) ? fullDate.format(new Date(v)) : String(v))

/** Column names that hold identifiers: shown as plain digits, never summed or charted. */
const isId = (c: string) => c === 'id' || c === PROJECT.key || c.endsWith('_id')

/** A table cell: scores by their configured format, ids as plain digits, the rest grouped. */
function tableCell(col: string, v: Cell): string {
  if (v == null) return '—'
  if (typeof v === 'number') {
    if (isId(col)) return String(v)
    if (col in SCORES) return formatScore(col, v, { precise: true })
    return Number.isInteger(v) ? count(v) : count(Math.round(v * 100) / 100)
  }
  return String(v)
}

/** Big numbers for KPI tiles: compact above a million, full precision in the tooltip. */
function kpi(format: string | undefined, v: number): string {
  if (Math.abs(v) >= 1e6) return format === 'money' ? compactUsd.format(v) : short(v)
  return formatValue(format, v, { precise: format === 'money' && Math.abs(v) < 1000 })
}

function downloadCsv(result: QueryResult, name: string) {
  const esc = (v: Cell) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csv = [result.columns.join(','), ...result.rows.map((r) => r.map(esc).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `${name.replace(/[^\w-]+/g, '-').toLowerCase()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------- frame ----------

function ToolButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-pressed={active}
      className={cx('grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg [&_svg]:size-3.5',
        active && 'bg-hover text-fg')}>
      {children}
    </button>
  )
}

type FrameProps = {
  w: Widget
  /** A line under the title: the headline number for charts, a caption for tiles. */
  sub?: ReactNode
  sql?: string
  result?: QueryResult
  loading?: boolean
  error?: string
  onRefresh?: () => void
  expandable?: boolean
  tile?: boolean
  children: ReactNode
}

function Frame({ w, sub, sql, result, loading, error, onRefresh, expandable, tile, children }: FrameProps) {
  const { editing, expand } = useContext(DashCtx)
  const [showSql, setShowSql] = useState(false)
  const tools = !editing && (sql || onRefresh || (expandable && expand))
  return (
    <section className="group/w relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(10_35_80/0.04)] transition-shadow hover:shadow-[0_2px_10px_rgb(10_35_80/0.07)]">
      <header className={cx('flex items-start justify-between gap-2 px-4', tile ? 'pt-3' : 'pt-3.5')}>
        <div className="min-w-0">
          <h3 className={cx('truncate', tile ? 'text-[12px] font-medium text-muted' : 'text-[13px] font-semibold')}>{w.title}</h3>
          {sub && !tile && <div className="mt-0.5 text-[12px] text-faint">{sub}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {loading && result && <span className="size-1.5 animate-pulse rounded-full bg-accent" title="Refreshing" />}
          {tools && (
            <div className="-mr-1.5 -mt-1 flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/w:opacity-100">
              {sql && <ToolButton label={showSql ? 'Show the data' : 'Show SQL'} active={showSql} onClick={() => setShowSql((s) => !s)}><Code2 /></ToolButton>}
              {result && <ToolButton label="Download CSV" onClick={() => downloadCsv(result, w.title)}><Download /></ToolButton>}
              {onRefresh && <ToolButton label="Refresh" onClick={onRefresh}><RefreshCw className={cx(loading && 'animate-spin')} /></ToolButton>}
              {expandable && expand && <ToolButton label="Expand" onClick={() => expand(w)}><Maximize2 /></ToolButton>}
            </div>
          )}
        </div>
      </header>
      <div className={cx('flex min-h-0 flex-1 flex-col px-4', tile ? 'pb-3' : 'pb-4 pt-3')}>
        {showSql && sql ? <SqlBlock sql={sql} label="Query" maxHeight={1000} className="min-h-0 flex-1 text-[12px]" />
          : error ? <p className="line-clamp-4 font-mono text-[12px] text-danger">{error}</p>
          : children}
      </div>
    </section>
  )
}

// ---------- metric ----------

function MetricWidget({ w }: { w: Extract<Widget, { type: 'metric' }> }) {
  const run = useServerFn(runQuery)
  const { data, error, loading, refresh } = useLoad(() => run({ data: { sql: w.config.sql } }), [w.config.sql])
  const value = data?.rows[0]?.[0] as Cell | undefined
  return (
    <Frame w={w} tile sql={w.config.sql} result={data} loading={loading} error={error} onRefresh={refresh}>
      {loading && !data ? <Skeleton className="mt-auto h-8 w-32" /> : (
        <div className="mt-auto">
          <p className="num truncate text-[28px] font-semibold leading-none tracking-tight"
            title={typeof value === 'number' ? formatValue(w.config.format, value, { precise: true }) : undefined}>
            {value == null ? '—' : typeof value === 'number' ? kpi(w.config.format, value) : String(value)}
          </p>
          {data?.columns[0] && <p className="mt-1.5 truncate text-[12px] text-faint">{data.columns[0].replace(/_/g, ' ')}</p>}
        </div>
      )}
    </Frame>
  )
}

// ---------- segment (live) ----------

function SegmentWidget({ w }: { w: Extract<Widget, { type: 'segment' }> }) {
  const [rows, details] = useQuery(queries.segments.all())
  const seg = rows.find((s) => s.name === w.config.segment)
  const total = rows.find((s) => !s.rules?.length)?.size ?? 0
  const share = seg && total && seg.rules?.length ? ((seg.size ?? 0) / total) * 100 : null
  const error = details.type === 'error' ? details.error.message : details.type === 'complete' && !seg ? `No segment named ${w.config.segment}` : undefined
  return (
    <Frame w={w} tile error={error}>
      {!seg ? <Skeleton className="mt-auto h-8 w-32" /> : (
        <div className="mt-auto">
          <p className="flex items-baseline gap-2">
            <span className="num text-[28px] font-semibold leading-none tracking-tight">{count(seg.size)}</span>
            {share != null && <span className="num text-[12px] text-muted">{share < 1 ? share.toFixed(1) : Math.round(share)}%</span>}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-faint"><span className="size-1.5 rounded-full bg-success" />live</span>
          </p>
          {share != null ? (
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-subtle" title={`${share.toFixed(1)}% of ${PROJECT.entityLabel.toLowerCase()}`}>
              <div className="h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-700" style={{ width: `${Math.max(share, 1)}%` }} />
            </div>
          ) : <p className="mt-1.5 truncate text-[12px] text-faint">{seg.description ?? `All ${PROJECT.entityLabel.toLowerCase()}`}</p>}
        </div>
      )}
    </Frame>
  )
}

// ---------- distribution ----------

type Bin = { bin: number; lo: number; hi: number; n: number }

function useBins(column: string, bins: number) {
  const fetchBins = useServerFn(distribution)
  return useLoad(
    () => fetchBins({ data: { column, bins } }).then((r) =>
      r.rows.map((row) => ({ bin: row[0] as number, lo: row[1] as number, hi: row[2] as number, n: row[3] as number })) as Bin[]),
    [column, bins],
  )
}

function Histogram({ data, column, height = '100%' }: { data: Bin[]; column: string; height?: number | string }) {
  return (
    <div className="min-h-0 flex-1" style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} barCategoryGap={2} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="lo" tickFormatter={(v) => formatScore(column, v)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tickFormatter={(v) => short(v)} tick={axisTick} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            {...tooltipStyle}
            formatter={(v) => [count(v as number), PROJECT.entityLabel]}
            labelFormatter={(_, p) => {
              const b = p?.[0]?.payload as Bin | undefined
              return b ? `${formatScore(column, b.lo, { precise: true })} to ${formatScore(column, b.hi, { precise: true })}` : ''
            }}
          />
          <Bar dataKey="n" fill={SERIES[0]} radius={[4, 4, 0, 0]} {...ANIM} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Where half the entities fall below, read off the bins (so it is as precise as one bin). */
function binMedian(data: Bin[]) {
  const total = data.reduce((s, b) => s + b.n, 0)
  let seen = 0
  for (const b of data) {
    seen += b.n
    if (seen >= total / 2) return (b.lo + b.hi) / 2
  }
  return null
}

export function DistributionWidget({ w }: { w: Extract<Widget, { type: 'distribution' }> }) {
  const column = w.config.column
  const { data, error, loading, refresh } = useBins(column, w.config.bins ?? 20)
  const median = data && binMedian(data)
  return (
    <Frame w={w} loading={loading} error={error} onRefresh={refresh} expandable
      sub={median != null ? <><span className="num text-fg">{formatScore(column, median)}</span> median {scoreLabel(column).toLowerCase()}</> : `${PROJECT.entityLabel} by ${scoreLabel(column).toLowerCase()}`}>
      {!data ? <Skeleton className="h-full min-h-40" /> : <Histogram data={data} column={column} />}
    </Frame>
  )
}

// ---------- chart ----------

type ChartProps = { kind: ChartKind; result: QueryResult; x: string; y: string; height?: number | string; color?: number; perCategory?: boolean }

const ANIM = { isAnimationActive: true, animationDuration: 700, animationEasing: 'ease-out' as const }

function chartData(result: QueryResult, x: string, y: string) {
  const xi = result.columns.indexOf(x)
  const yi = result.columns.indexOf(y)
  if (xi < 0 || yi < 0) return null
  return result.rows.map((r) => ({ [x]: r[xi], [y]: Number(r[yi]) }))
}

export function SimpleChart({ kind, result, x, y, height = 176, color, perCategory }: ChartProps) {
  const data = chartData(result, x, y)
  if (!data) return <p className="text-[12px] text-danger">The result has no column named {result.columns.includes(x) ? y : x}.</p>
  const main = SERIES[((color ?? 1) - 1) % SERIES.length]
  const slot = (i: number) => SERIES[((color ?? 1) - 1 + i) % SERIES.length]
  const margin = { left: 0, right: 12, top: 8, bottom: 0 }
  const grid = <CartesianGrid vertical={kind === 'hbar'} horizontal={kind !== 'hbar'} stroke="var(--chart-grid)" />
  const tip = <Tooltip {...tooltipStyle} cursor={kind === 'bar' || kind === 'hbar' ? { fill: 'var(--hover)' } : { stroke: 'var(--line-strong)' }}
    labelFormatter={xLabel} formatter={(v) => [tableCell(y, v as number), y.replace(/_/g, ' ')]} />
  const xAxis = <XAxis dataKey={x} tick={axisTick} axisLine={false} tickLine={false} minTickGap={16} interval="preserveStartEnd" tickFormatter={xTick} />
  const yAxis = <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => short(v)} />

  if (kind === 'pie') return <Donut data={data} x={x} y={y} slot={slot} height={height} />
  return (
    <div className="min-h-0 flex-1" style={{ height }}>
      <ResponsiveContainer>
        {kind === 'line' ? (
          <LineChart data={data} margin={margin}>{grid}{xAxis}{yAxis}{tip}
            <Line dataKey={y} stroke={main} strokeWidth={2} dot={data.length <= 24 ? { r: 3, strokeWidth: 0, fill: main } : false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} {...ANIM} />
          </LineChart>
        ) : kind === 'area' ? (
          <AreaChart data={data} margin={margin}>{grid}{xAxis}{yAxis}{tip}
            <defs>
              <linearGradient id={`area-${color ?? 1}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={main} stopOpacity={0.22} />
                <stop offset="1" stopColor={main} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area dataKey={y} stroke={main} strokeWidth={2} fill={`url(#area-${color ?? 1})`} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} {...ANIM} />
          </AreaChart>
        ) : kind === 'hbar' ? (
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 0 }} barCategoryGap="22%">{grid}
            <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => short(v)} />
            <YAxis type="category" dataKey={x} tick={axisTick} axisLine={false} tickLine={false} width={96} interval={0} />{tip}
            <Bar dataKey={y} fill={main} radius={[0, 4, 4, 0]} maxBarSize={22} {...ANIM}>
              {perCategory && data.map((_, i) => <ChartCell key={i} fill={slot(i)} />)}
            </Bar>
          </BarChart>
        ) : (
          <BarChart data={data} margin={margin} barCategoryGap="20%">{grid}{xAxis}{yAxis}{tip}
            <Bar dataKey={y} fill={main} radius={[4, 4, 0, 0]} maxBarSize={48} {...ANIM}>
              {perCategory && data.map((_, i) => <ChartCell key={i} fill={slot(i)} />)}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

/** A donut with its total in the middle and a legend that carries each slice's value and share. */
function Donut({ data, x, y, slot, height }: { data: Record<string, unknown>[]; x: string; y: string; slot: (i: number) => string; height: number | string }) {
  const total = data.reduce((s, d) => s + (Number(d[y]) || 0), 0)
  const [active, setActive] = useState<number | null>(null)
  return (
    <div className="flex min-h-0 flex-1 items-center gap-4" style={{ height }}>
      <div className="relative aspect-square h-full max-h-[190px] min-w-0 shrink">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey={y} nameKey={x} innerRadius="62%" outerRadius="96%" paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2}
              onMouseEnter={(_, i) => setActive(i)} onMouseLeave={() => setActive(null)} {...ANIM}>
              {data.map((_, i) => <ChartCell key={i} fill={slot(i)} opacity={active == null || active === i ? 1 : 0.35} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="num text-[18px] font-semibold leading-tight tracking-tight">{short(active == null ? total : Number(data[active][y]))}</p>
            <p className="max-w-20 truncate text-[11px] text-faint">{active == null ? 'total' : String(data[active][x])}</p>
          </div>
        </div>
      </div>
      <ul className="min-w-[120px] flex-1 space-y-1 overflow-auto text-[12px]">
        {data.map((d, i) => (
          <li key={i} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            className={cx('flex items-center gap-2 rounded px-1.5 py-0.5', active === i && 'bg-hover')}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: slot(i) }} />
            <span className="min-w-0 flex-1 truncate">{String(d[x])}</span>
            <span className="num text-muted">{total ? `${Math.round((Number(d[y]) / total) * 100)}%` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The line under a chart's title: the latest value and its change for series, the leader for categories. */
function headline(kind: ChartKind, result: QueryResult, x: string, y: string): ReactNode {
  const data = chartData(result, x, y)
  if (!data || data.length === 0) return null
  const val = (d: Record<string, unknown>) => Number(d[y])
  if (kind === 'line' || kind === 'area') {
    const last = data[data.length - 1]
    const prev = data.length > 1 ? val(data[data.length - 2]) : null
    const delta = prev ? ((val(last) - prev) / Math.abs(prev)) * 100 : null
    const Arrow = delta != null && delta < 0 ? ArrowDownRight : ArrowUpRight
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="num text-fg">{tableCell(y, val(last))}</span>
        <span>{xLabel(last[x])}</span>
        {delta != null && Number.isFinite(delta) && (
          <span className="num inline-flex items-center text-muted"><Arrow className="size-3" />{Math.abs(delta).toFixed(1)}% vs previous</span>
        )}
      </span>
    )
  }
  const top = data.reduce((a, b) => (val(b) > val(a) ? b : a))
  return <span><span className="text-fg">{String(top[x])}</span> leads with <span className="num text-fg">{tableCell(y, val(top))}</span></span>
}

function ChartWidget({ w }: { w: Extract<Widget, { type: 'chart' }> }) {
  const run = useServerFn(runQuery)
  const { data, error, loading, refresh } = useLoad(() => run({ data: { sql: w.config.sql } }), [w.config.sql])
  return (
    <Frame w={w} sql={w.config.sql} result={data} loading={loading} error={error} onRefresh={refresh} expandable
      sub={data && headline(w.config.kind, data, w.config.x, w.config.y)}>
      {!data ? <Skeleton className="h-full min-h-40" /> : data.rows.length === 0 ? <p className="text-[13px] text-muted">No rows.</p>
        : <SimpleChart kind={w.config.kind} result={data} x={w.config.x} y={w.config.y} height="100%" color={w.config.color} perCategory={w.config.perCategory} />}
    </Frame>
  )
}

// ---------- table ----------

/** A compact table. The first numeric measure gets an inline bar so the ranking reads at a glance. */
function MiniTable({ result, max }: { result: QueryResult; max: number }) {
  const rows = result.rows.slice(0, max)
  const numeric = result.columns.map((c, j) => !isId(c) && rows.length > 0 && rows.every((r) => r[j] == null || typeof r[j] === 'number'))
  // Wide tables have no room for the bar; they keep plain numbers.
  const barCol = result.columns.length <= 3 ? numeric.findIndex(Boolean) : -1
  const barMax = barCol >= 0 ? Math.max(...rows.map((r) => Math.abs(Number(r[barCol]) || 0)), 1) : 1
  return (
    <div className="-mx-4 min-h-0 flex-1 overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 z-[1] bg-surface">
          <tr className="border-b border-line">
            {result.columns.map((c, j) => (
              <th key={c} className={cx('h-8 whitespace-nowrap px-3 text-[11px] font-medium text-faint first:pl-4 last:pr-4', numeric[j] ? 'text-right' : 'text-left')}>
                {c in SCORES ? scoreLabel(c) : c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0 hover:bg-hover">
              {r.map((v, j) => (
                <td key={j} className={cx('num h-8 whitespace-nowrap px-3 first:pl-4 last:pr-4', numeric[j] && 'text-right', v == null && 'text-faint', isId(result.columns[j]) && 'text-muted')}>
                  {j === barCol ? (
                    <span className="inline-flex items-center justify-end gap-2.5">
                      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-subtle" aria-hidden>
                        <span className="block h-full rounded-full bg-[var(--chart-1)] opacity-70" style={{ width: `${(Math.abs(Number(v) || 0) / barMax) * 100}%` }} />
                      </span>
                      {tableCell(result.columns[j], v)}
                    </span>
                  ) : tableCell(result.columns[j], v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableWidget({ w }: { w: Extract<Widget, { type: 'table' }> }) {
  const run = useServerFn(runQuery)
  const { data, error, loading, refresh } = useLoad(() => run({ data: { sql: w.config.sql } }), [w.config.sql])
  return (
    <Frame w={w} sql={w.config.sql} result={data} loading={loading} error={error} onRefresh={refresh} expandable
      sub={data && `${count(Math.min(data.rows.length, w.config.limit ?? 20))} rows`}>
      {!data ? <Skeleton className="h-full min-h-40" /> : data.rows.length === 0 ? <p className="text-[13px] text-muted">No rows.</p>
        : <MiniTable result={data} max={w.config.limit ?? 20} />}
    </Frame>
  )
}

// ---------- text ----------

function TextWidget({ w }: { w: Extract<Widget, { type: 'text' }> }) {
  return (
    <Frame w={w}>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto text-[13px] leading-relaxed text-muted">
        {w.config.body.split(/\n{2,}/).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
      </div>
    </Frame>
  )
}

export function WidgetView({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case 'metric':
      return <MetricWidget w={widget} />
    case 'segment':
      return <SegmentWidget w={widget} />
    case 'distribution':
      return <DistributionWidget w={widget} />
    case 'chart':
      return <ChartWidget w={widget} />
    case 'table':
      return <TableWidget w={widget} />
    case 'text':
      return <TextWidget w={widget} />
  }
}

// ---------- expanded ----------

/** One widget at full size, with its rows in the result explorer underneath. */
export function ExpandedWidget({ widget: w, onClose }: { widget: Widget; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 grid place-items-center p-4 sm:p-8" onClick={onClose}>
      <div className="anim-fade absolute inset-0 bg-overlay" />
      <div role="dialog" aria-label={w.title} onClick={(e) => e.stopPropagation()}
        className="anim-rise relative flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="truncate text-[15px] font-semibold">{w.title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"><X className="size-4" /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {w.type === 'distribution' ? <ExpandedDistribution w={w} />
            : w.type === 'chart' || w.type === 'table' || w.type === 'metric' ? <ExpandedQuery w={w} /> : null}
        </div>
      </div>
    </div>
  )
}

function ExpandedDistribution({ w }: { w: Extract<Widget, { type: 'distribution' }> }) {
  const { data, error } = useBins(w.config.column, w.config.bins ?? 20)
  if (error) return <p className="font-mono text-[12px] text-danger">{error}</p>
  if (!data) return <Skeleton className="h-[380px]" />
  return (
    <>
      <div className="flex h-[380px] flex-col"><Histogram data={data} column={w.config.column} /></div>
      <ResultView columns={['from', 'to', PROJECT.entityLabel.toLowerCase()]} rows={data.map((b) => [b.lo, b.hi, b.n])} name={w.title} />
    </>
  )
}

function ExpandedQuery({ w }: { w: Extract<Widget, { type: 'chart' | 'table' | 'metric' }> }) {
  const run = useServerFn(runQuery)
  const { data, error } = useLoad(() => run({ data: { sql: w.config.sql } }), [w.config.sql])
  if (error) return <p className="font-mono text-[12px] text-danger">{error}</p>
  if (!data) return <Skeleton className="h-[380px]" />
  return (
    <>
      {w.type === 'chart' && (
        <div className="flex h-[380px] flex-col">
          <p className="mb-3 text-[12px] text-faint">{headline(w.config.kind, data, w.config.x, w.config.y)}</p>
          <SimpleChart kind={w.config.kind} result={data} x={w.config.x} y={w.config.y} height="100%" color={w.config.color} perCategory={w.config.perCategory} />
        </div>
      )}
      <ResultView columns={data.columns} rows={data.rows} name={w.title} />
      <SqlBlock sql={w.config.sql} label="Query" />
    </>
  )
}

// ---------- grid placement ----------

export const SIZE_CLASS: Record<1 | 2 | 3, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3' }

/** Rows a widget spans in the page grid (see the note at the top). */
export function rowSpan(w: Widget): 1 | 2 | 3 {
  if (w.type === 'metric' || w.type === 'segment') return 1
  if (w.type === 'text') return w.size === 3 ? 1 : 2
  return 3
}
export const ROW_CLASS: Record<1 | 2 | 3, string> = { 1: 'row-span-1', 2: 'row-span-2', 3: 'row-span-3' }
