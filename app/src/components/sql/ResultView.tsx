// A query result you can explore: a table by default, filters and a search that scope both
// the table and the chart, sortable columns, CSV export, and a chart you configure (type,
// X, one or more measures, order). Several measures become small multiples, one axis each,
// because a count and an average never share a scale.
import {
  AreaChart as AreaIcon, BarChart3, ChartScatter, Download, Filter as FilterIcon, LineChart as LineIcon, Plus, Search,
  Table2, X,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis,
  YAxis, ZAxis,
} from 'recharts'
import type { Cell } from '~/lib/types'
import { cell, short } from '~/components/ui/format'
import { Button, DataTable, Input, Select, Tabs, cx, useDismiss, type SortState } from '~/components/ui'

// Categorical slot 1, validated for both themes (see styles.css). Every chart here is
// single-series, so one hue carries every mark.
export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']
export const axisTick = { fontSize: 11, fill: 'var(--faint)' }
export const tooltipStyle = {
  contentStyle: {
    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12,
    boxShadow: '0 4px 16px rgb(0 0 0 / 0.08)', color: 'var(--fg)', padding: '8px 10px',
  },
  labelStyle: { color: 'var(--muted)', marginBottom: 4 },
  itemStyle: { color: 'var(--fg)', padding: 0 },
  cursor: { fill: 'var(--hover)' },
}

// ---------- filters ----------

type Op = 'contains' | 'not_contains' | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'not_empty'
type Filter = { col: number; op: Op; value: string }
const OPS: Record<Op, { label: string; numeric?: boolean; text?: boolean; noValue?: boolean }> = {
  contains: { label: 'contains', text: true },
  not_contains: { label: 'does not contain', text: true },
  eq: { label: '=', numeric: true, text: true },
  neq: { label: '≠', numeric: true, text: true },
  gt: { label: '>', numeric: true },
  gte: { label: '≥', numeric: true },
  lt: { label: '<', numeric: true },
  lte: { label: '≤', numeric: true },
  empty: { label: 'is empty', numeric: true, text: true, noValue: true },
  not_empty: { label: 'is not empty', numeric: true, text: true, noValue: true },
}

function passes(v: Cell, f: Filter, numeric: boolean): boolean {
  if (f.op === 'empty') return v == null || v === ''
  if (f.op === 'not_empty') return v != null && v !== ''
  if (v == null) return false
  if (numeric) {
    const a = Number(v), b = Number(f.value)
    if (Number.isNaN(b)) return true
    return { eq: a === b, neq: a !== b, gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[f.op as 'eq'] ?? true
  }
  const a = String(v).toLowerCase(), b = f.value.toLowerCase()
  return { contains: a.includes(b), not_contains: !a.includes(b), eq: a === b, neq: a !== b }[f.op as 'eq'] ?? true
}

function FilterMenu({ columns, numeric, onAdd }: { columns: string[]; numeric: boolean[]; onAdd: (f: Filter) => void }) {
  const [open, setOpen] = useState(false)
  const [col, setCol] = useState(0)
  const [op, setOp] = useState<Op>(numeric[0] ? 'gt' : 'contains')
  const [value, setValue] = useState('')
  const ref = useDismiss(open, () => setOpen(false))
  const ops = (Object.keys(OPS) as Op[]).filter((o) => (numeric[col] ? OPS[o].numeric : OPS[o].text))
  const add = () => {
    if (!OPS[op].noValue && value.trim() === '') return
    onAdd({ col, op, value: value.trim() })
    setValue('')
    setOpen(false)
  }
  return (
    <div ref={ref} className="relative">
      <Button size="sm" icon={<FilterIcon />} onClick={() => setOpen(!open)} aria-expanded={open}>Filter</Button>
      {open && (
        <div className="anim-rise absolute left-0 top-full z-20 mt-1 w-72 space-y-2 rounded-lg border border-line bg-surface p-3 shadow-lg shadow-black/5">
          <Select value={col} aria-label="Column" onChange={(e) => {
            const c = Number(e.target.value)
            setCol(c)
            setOp(numeric[c] ? 'gt' : 'contains')
          }}>
            {columns.map((c, i) => <option key={c} value={i}>{c}</option>)}
          </Select>
          <div className="flex gap-2">
            <Select value={op} aria-label="Condition" onChange={(e) => setOp(e.target.value as Op)} className="!w-36">
              {ops.map((o) => <option key={o} value={o}>{OPS[o].label}</option>)}
            </Select>
            {!OPS[op].noValue && (
              <Input autoFocus value={value} aria-label="Value" type={numeric[col] ? 'number' : 'text'} step="any"
                onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Value" />
            )}
          </div>
          <Button size="sm" variant="primary" icon={<Plus />} className="w-full" onClick={add}>Add filter</Button>
        </div>
      )}
    </div>
  )
}

// ---------- chart settings ----------

type ChartType = 'bar' | 'hbar' | 'line' | 'area' | 'scatter'
const TYPES: { value: ChartType; label: string; icon: ReactNode }[] = [
  { value: 'bar', label: 'Column', icon: <BarChart3 className="size-3.5" /> },
  { value: 'hbar', label: 'Bar', icon: <BarChart3 className="size-3.5 rotate-90" /> },
  { value: 'line', label: 'Line', icon: <LineIcon className="size-3.5" /> },
  { value: 'area', label: 'Area', icon: <AreaIcon className="size-3.5" /> },
  { value: 'scatter', label: 'Scatter', icon: <ChartScatter className="size-3.5" /> },
]
const MAX_BARS = 50

const isTime = (rows: Cell[][], i: number) => rows.length > 0 && rows.every((r) => r[i] == null || (typeof r[i] === 'string' && /^\d{4}-\d{2}/.test(r[i] as string)))

function defaults(columns: string[], rows: Cell[][], numeric: boolean[]) {
  const x = Math.max(0, numeric.findIndex((n) => !n))
  const firstY = numeric.findIndex((n, i) => n && i !== x)
  const time = isTime(rows, x)
  const longLabels = rows.some((r) => String(r[x] ?? '').length > 14) || rows.length > 12
  return { type: (time ? 'line' : longLabels ? 'hbar' : 'bar') as ChartType, x, ys: firstY >= 0 ? [firstY] : [], order: (time ? 'x' : 'none') as 'none' | 'desc' | 'asc' | 'x' }
}

// ---------- the view ----------

export function ResultView({ columns, rows, name = 'result' }: { columns: string[]; rows: Cell[][]; name?: string }) {
  const numeric = useMemo(() => columns.map((_, i) => rows.length > 0 && rows.every((r) => r[i] == null || typeof r[i] === 'number')), [columns, rows])
  const [view, setView] = useState<'table' | 'chart'>('table')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filter[]>([])
  const [sort, setSort] = useState<SortState>(null)
  const [chart, setChart] = useState(() => defaults(columns, rows, numeric))
  const canChart = numeric.some(Boolean) && rows.length > 0

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows.filter((r) => filters.every((f) => passes(r[f.col], f, numeric[f.col])))
    if (q) out = out.filter((r) => r.some((v) => v != null && String(v).toLowerCase().includes(q)))
    if (sort) {
      const k = sort.col, d = sort.dir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => (a[k] == null ? 1 : b[k] == null ? -1 : a[k]! < b[k]! ? -d : a[k]! > b[k]! ? d : 0))
    }
    return out
  }, [rows, filters, search, sort, numeric])

  if (!rows.length) return <p className="text-[13px] text-muted">The query returned no rows.</p>

  const toggleSort = (col: number) =>
    setSort((s) => (s?.col !== col ? { col, dir: numeric[col] ? 'desc' : 'asc' } : s.dir === (numeric[col] ? 'desc' : 'asc') ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : null))

  const exportCsv = () => {
    const esc = (v: Cell) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const csv = [columns.join(','), ...shown.map((r) => r.map(esc).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${name}.csv`
    a.click()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canChart && (
          <Tabs value={view} onChange={setView} options={[
            { value: 'table', label: <span className="flex items-center gap-1.5"><Table2 className="size-3.5" />Table</span> },
            { value: 'chart', label: <span className="flex items-center gap-1.5"><BarChart3 className="size-3.5" />Chart</span> },
          ]} />
        )}
        <div className="relative w-full max-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rows" aria-label="Search rows" className="!h-7 pl-8 text-[12px]" />
        </div>
        <FilterMenu columns={columns} numeric={numeric} onAdd={(f) => setFilters((fs) => [...fs, f])} />
        <span className="num ml-auto text-[12px] text-faint">
          {shown.length === rows.length ? `${rows.length.toLocaleString()} rows` : `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`}
        </span>
        <Button size="sm" variant="ghost" icon={<Download />} onClick={exportCsv} disabled={!shown.length}>CSV</Button>
      </div>

      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f, i) => (
            <span key={i} className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-surface pl-2 pr-1 text-[12px]">
              <span className="font-mono">{columns[f.col]}</span>
              <span className="text-muted">{OPS[f.op].label}</span>
              {!OPS[f.op].noValue && <span className="font-medium">{f.value}</span>}
              <button aria-label="Remove filter" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))} className="rounded p-0.5 text-faint hover:bg-hover hover:text-fg">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button onClick={() => setFilters([])} className="text-[12px] text-muted hover:text-fg">Clear all</button>
        </div>
      )}

      {view === 'table' || !canChart ? (
        shown.length ? <DataTable columns={columns} rows={shown} sort={sort} onSort={toggleSort} />
          : <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">No rows match these filters.</p>
      ) : (
        <ChartPanel columns={columns} rows={shown} numeric={numeric} chart={chart} setChart={setChart} />
      )}
    </div>
  )
}

function ChartPanel({ columns, rows, numeric, chart, setChart }: {
  columns: string[]; rows: Cell[][]; numeric: boolean[]
  chart: ReturnType<typeof defaults>; setChart: (c: ReturnType<typeof defaults>) => void
}) {
  const { type, x, ys, order } = chart
  const set = (patch: Partial<typeof chart>) => setChart({ ...chart, ...patch })
  const measures = columns.map((c, i) => ({ c, i })).filter(({ i }) => numeric[i] && i !== x)
  const scatterNeedsNumericX = type === 'scatter' && !numeric[x]

  let data = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, i === x && !numeric[i] ? cell(r[i]) : r[i]])))
  const y0 = columns[ys[0]]
  if (order === 'desc' || order === 'asc') {
    const d = order === 'desc' ? -1 : 1
    data = [...data].sort((a, b) => (((a[y0] as number) ?? 0) - ((b[y0] as number) ?? 0)) * d)
  } else if (order === 'x') {
    data = [...data].sort((a, b) => (a[columns[x]]! < b[columns[x]]! ? -1 : 1))
  }
  const capped = (type === 'bar' || type === 'hbar') && data.length > MAX_BARS
  if (capped) data = data.slice(0, MAX_BARS)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-md border border-line bg-subtle/50 p-3">
        <Control label="Chart">
          <div className="flex rounded-md border border-line bg-surface p-0.5">
            {TYPES.map((t) => (
              <button key={t.value} title={t.label} aria-label={t.label} aria-pressed={type === t.value} onClick={() => set({ type: t.value })}
                className={cx('flex h-6 items-center gap-1.5 rounded px-2 text-[12px]', type === t.value ? 'bg-subtle font-medium text-fg' : 'text-muted hover:text-fg')}>
                {t.icon}<span className="hidden xl:inline">{t.label}</span>
              </button>
            ))}
          </div>
        </Control>
        <Control label={type === 'hbar' ? 'Categories' : 'X axis'}>
          <Select value={x} className="!h-7 !w-44 text-[12px]" onChange={(e) => {
            const nx = Number(e.target.value)
            set({ x: nx, ys: ys.filter((y) => y !== nx).length ? ys.filter((y) => y !== nx) : measures.filter((m) => m.i !== nx).slice(0, 1).map((m) => m.i) })
          }}>
            {columns.map((c, i) => <option key={c} value={i}>{c}</option>)}
          </Select>
        </Control>
        <Control label="Measures">
          <div className="flex flex-wrap gap-1">
            {measures.map(({ c, i }) => {
              const on = ys.includes(i)
              return (
                <button key={c} aria-pressed={on} onClick={() => set({ ys: on ? ys.filter((y) => y !== i) : [...ys, i].slice(-3) })}
                  className={cx('h-7 rounded-md border px-2 font-mono text-[11.5px] transition-colors',
                    on ? 'border-accent/40 bg-accent-subtle text-accent' : 'border-line bg-surface text-muted hover:text-fg')}>
                  {c}
                </button>
              )
            })}
          </div>
        </Control>
        {type !== 'scatter' && (
          <Control label="Order">
            <Select value={order} className="!h-7 !w-48 text-[12px]" onChange={(e) => set({ order: e.target.value as typeof order })}>
              <option value="none">As returned</option>
              <option value="desc">Highest {y0 ?? 'value'} first</option>
              <option value="asc">Lowest {y0 ?? 'value'} first</option>
              <option value="x">By {columns[x]}</option>
            </Select>
          </Control>
        )}
      </div>

      {!ys.length ? (
        <p className="text-[13px] text-muted">Pick at least one measure to plot.</p>
      ) : scatterNeedsNumericX ? (
        <p className="text-[13px] text-muted">A scatter plot needs a numeric X axis. Pick one, or choose another chart type.</p>
      ) : (
        <div className={ys.length > 1 ? 'grid gap-5 md:grid-cols-2 xl:grid-cols-3' : ''}>
          {ys.map((yi) => (
            <div key={yi}>
              {ys.length > 1 && <p className="mb-1 font-mono text-[12px] text-muted">{columns[yi]}</p>}
              <div className={ys.length > 1 ? 'h-56' : type === 'hbar' ? '' : 'h-72'} style={type === 'hbar' ? { height: Math.max(160, data.length * 28 + 40) } : undefined}>
                <OneChart type={type} data={data} x={columns[x]} y={columns[yi]} xNumeric={numeric[x]} />
              </div>
            </div>
          ))}
        </div>
      )}
      {capped && <p className="text-[12px] text-faint">Showing the first {MAX_BARS} of {rows.length} rows. Filter or change the order to see others.</p>}
    </div>
  )
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted">{label}</p>
      {children}
    </div>
  )
}

function OneChart({ type, data, x, y, xNumeric }: { type: ChartType; data: Record<string, unknown>[]; x: string; y: string; xNumeric: boolean }) {
  const tip = <Tooltip {...tooltipStyle} formatter={(v) => [cell(v as number), y]} />
  const grid = <CartesianGrid vertical={type === 'scatter'} horizontal={type !== 'hbar'} stroke="var(--chart-grid)" />
  const margin = { left: 0, right: 12, top: 8, bottom: 0 }
  return (
    <ResponsiveContainer>
      {type === 'hbar' ? (
        <BarChart data={data} layout="vertical" margin={margin} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => short(v)} />
          <YAxis type="category" dataKey={x} tick={axisTick} axisLine={false} tickLine={false} width={120} interval={0} />
          {tip}
          <Bar dataKey={y} fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      ) : type === 'line' ? (
        <LineChart data={data} margin={margin}>
          {grid}
          <XAxis dataKey={x} tick={axisTick} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => short(v)} />
          <Tooltip {...tooltipStyle} cursor={{ stroke: 'var(--line-strong)' }} formatter={(v) => [cell(v as number), y]} />
          <Line dataKey={y} stroke={SERIES[0]} strokeWidth={2} dot={data.length <= 24 ? { r: 3, strokeWidth: 0, fill: SERIES[0] } : false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
        </LineChart>
      ) : type === 'area' ? (
        <AreaChart data={data} margin={margin}>
          {grid}
          <XAxis dataKey={x} tick={axisTick} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => short(v)} />
          <Tooltip {...tooltipStyle} cursor={{ stroke: 'var(--line-strong)' }} formatter={(v) => [cell(v as number), y]} />
          <Area dataKey={y} stroke={SERIES[0]} strokeWidth={2} fill={SERIES[0]} fillOpacity={0.12} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
        </AreaChart>
      ) : type === 'scatter' && xNumeric ? (
        <ScatterChart margin={margin}>
          {grid}
          <XAxis type="number" dataKey={x} name={x} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => short(v)} />
          <YAxis type="number" dataKey={y} name={y} tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => short(v)} />
          <ZAxis range={[48, 48]} />
          <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: '3 3', stroke: 'var(--line-strong)' }} formatter={(v) => cell(v as number)} />
          <Scatter data={data} fill={SERIES[0]} fillOpacity={0.75} stroke="var(--surface)" strokeWidth={1} />
        </ScatterChart>
      ) : (
        <BarChart data={data} margin={margin} barCategoryGap="20%">
          {grid}
          <XAxis dataKey={x} tick={axisTick} axisLine={false} tickLine={false} minTickGap={8} interval="preserveStartEnd" />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => short(v)} />
          {tip}
          <Bar dataKey={y} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}
