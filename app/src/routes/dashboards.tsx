import { Link, Outlet, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { AlignLeft, ArrowUpRight, BarChart3, Gauge, Hash, LayoutDashboard, Plus, Search, Shapes, Table2, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConfig } from '~/components/config/state'
import { useToast } from '~/components/ui/Toaster'
import { Button, Empty, Input, PageHeader, Skeleton, cx } from '~/components/ui'
import { scoreLabel } from '~/components/ui/format'
import { rowSpan } from '~/components/dashboard/widgets'
import { NUMERIC_SCORES, PROJECT } from '~/generated/project'
import { useMe } from '~/lib/session'
import { createDashboard, listDashboards, type ChartKind, type Dashboard, type Widget } from '~/server/dashboards'

export const Route = createFileRoute('/dashboards')({ component: DashboardsLayout })

function DashboardsLayout() {
  // /dashboards shows the list; /dashboards/<id> renders the child route.
  const path = useRouterState({ select: (s) => s.location.pathname })
  return path.replace(/\/$/, '') === '/dashboards' ? <DashboardList /> : <Outlet />
}

const when = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

type Sample = { name: string; description: string; widgets: Widget[] }

/** Sample dashboards for the retail demo. SQL uses the semantic model's tables and runs on DuckDB and Postgres. */
function sampleDashboards(labels: Record<string, string>): Sample[] {
  const t = PROJECT.scoreTable
  const k = PROJECT.key
  const score = (NUMERIC_SCORES as readonly string[]).includes('ltv') ? 'ltv' : NUMERIC_SCORES[0]
  const id = () => Math.random().toString(36).slice(2, 10)
  const names = Object.keys(labels).length ? Object.keys(labels).slice(0, 4) : ['all', 'vip', 'at_risk', 'never_bought']
  const w = (x: Omit<Widget, 'id'>): Widget => ({ id: id(), ...x } as Widget)
  const chart = (title: string, size: 1 | 2 | 3, sql: string, kind: ChartKind, x: string, y: string, color = 1, perCategory = false) =>
    w({ type: 'chart', title, size, config: { sql, kind, x, y, color, perCategory: perCategory || undefined } })

  const overview: Sample = {
    name: 'Customer overview',
    description: 'Segment sizes, lifetime value and where customers come from.',
    widgets: [
      ...names.map((n) => w({ type: 'segment', title: labels[n] ?? n.replace(/_/g, ' '), size: 1, config: { segment: n } })),
      w({ type: 'distribution', title: `${scoreLabelText(score)} distribution`, size: 2, config: { column: score, bins: 20 } }),
      w({ type: 'metric', title: `Average ${scoreLabelText(score).toLowerCase()}`, size: 1, config: { sql: `SELECT ROUND(AVG(${score}), 2) AS avg_${score} FROM ${t}`, format: score === 'ltv' ? 'money' : 'number' } }),
      chart(`${PROJECT.entityLabel} by traffic source`, 2, `SELECT u.traffic_source AS source, COUNT(*) AS customers FROM ${t} s JOIN users u ON u.id = s.${k} GROUP BY 1 ORDER BY 2 DESC`, 'bar', 'source', 'customers', 1, true),
      w({ type: 'table', title: `Top ${PROJECT.entityLabel.toLowerCase()} by ${scoreLabelText(score).toLowerCase()}`, size: 1,
        config: { sql: `SELECT ${k}, ${score}, churn_risk FROM ${t} ORDER BY ${score} DESC LIMIT 10`, limit: 10 } }),
    ],
  }
  const revenue: Sample = {
    name: 'Revenue',
    description: 'Completed sales over time, order size and the channels that bring the money in.',
    widgets: [
      w({ type: 'metric', title: 'Revenue, all time', size: 1, config: { sql: `SELECT ROUND(SUM(total_spend), 0) AS revenue FROM ${t}`, format: 'money' } }),
      w({ type: 'metric', title: 'Orders', size: 1, config: { sql: `SELECT SUM(order_count) AS orders FROM ${t}`, format: 'count' } }),
      w({ type: 'metric', title: 'Average order value', size: 1, config: { sql: `SELECT ROUND(SUM(total_spend) / NULLIF(SUM(order_count), 0), 2) AS aov FROM ${t}`, format: 'money' } }),
      chart('Monthly revenue, last 24 months', 3,
        `SELECT CAST(DATE_TRUNC('month', oi.created_at) AS DATE) AS month, ROUND(SUM(oi.sale_price), 0) AS revenue FROM order_items oi WHERE oi.status NOT IN ('Cancelled', 'Returned') AND oi.created_at >= CURRENT_DATE - 730 GROUP BY 1 ORDER BY 1`,
        'area', 'month', 'revenue', 1),
      chart('Revenue by traffic source', 1, `SELECT u.traffic_source AS source, ROUND(SUM(s.total_spend), 0) AS revenue FROM ${t} s JOIN users u ON u.id = s.${k} GROUP BY 1 ORDER BY 2 DESC`, 'pie', 'source', 'revenue', 1),
      chart('Revenue by state', 2, `SELECT u.state, ROUND(SUM(s.total_spend), 0) AS revenue FROM ${t} s JOIN users u ON u.id = s.${k} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, 'hbar', 'state', 'revenue', 6),
    ],
  }
  const retention: Sample = {
    name: 'Retention',
    description: 'Who is at risk of leaving, how long customers stay, and what happens after the first order.',
    widgets: [
      w({ type: 'segment', title: 'At risk', size: 1, config: { segment: 'at_risk' } }),
      w({ type: 'segment', title: 'One-time buyers', size: 1, config: { segment: 'one_and_done' } }),
      w({ type: 'metric', title: 'Median days since last order', size: 1, config: { sql: `SELECT CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_since_last_order) AS INTEGER) AS median_days FROM ${t} WHERE order_count > 0`, format: 'days' } }),
      chart('Churn risk by tenure', 2,
        `SELECT CASE WHEN tenure_days < 90 THEN '0 to 3 months' WHEN tenure_days < 365 THEN '3 to 12 months' WHEN tenure_days < 730 THEN '1 to 2 years' ELSE '2 years and more' END AS tenure, ROUND(AVG(churn_risk) * 100, 1) AS avg_risk_pct FROM ${t} WHERE order_count > 0 GROUP BY 1 ORDER BY MIN(tenure_days)`,
        'bar', 'tenure', 'avg_risk_pct', 2, true),
      chart('Customers by orders placed', 1,
        `SELECT CASE WHEN order_count = 0 THEN 'none' WHEN order_count = 1 THEN '1' WHEN order_count <= 3 THEN '2 to 3' WHEN order_count <= 10 THEN '4 to 10' ELSE '11 and more' END AS orders, COUNT(*) AS customers FROM ${t} GROUP BY 1 ORDER BY MIN(order_count)`,
        'pie', 'orders', 'customers', 3),
      chart('Days since last order, buyers only', 3,
        `SELECT LEAST(CAST(days_since_last_order / 30 AS INTEGER) * 30, 720) AS days_bucket, COUNT(*) AS customers FROM ${t} WHERE order_count > 0 GROUP BY 1 ORDER BY 1`,
        'line', 'days_bucket', 'customers', 4),
    ],
  }
  const products: Sample = {
    name: 'Products',
    description: 'What sells, by department, category and brand.',
    widgets: [
      chart('Revenue by department', 1, `SELECT p.department, ROUND(SUM(oi.sale_price), 0) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.status NOT IN ('Cancelled', 'Returned') GROUP BY 1 ORDER BY 2 DESC`, 'pie', 'department', 'revenue', 4),
      chart('Revenue by category', 2, `SELECT p.category, ROUND(SUM(oi.sale_price), 0) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.status NOT IN ('Cancelled', 'Returned') GROUP BY 1 ORDER BY 2 DESC`, 'hbar', 'category', 'revenue', 1, true),
      chart('Items sold by brand', 2, `SELECT p.brand, COUNT(*) AS items FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.status NOT IN ('Cancelled', 'Returned') GROUP BY 1 ORDER BY 2 DESC`, 'bar', 'brand', 'items', 5, true),
      w({ type: 'table', title: 'Best sellers', size: 1, config: { sql: `SELECT p.category, p.brand, COUNT(*) AS items, ROUND(SUM(oi.sale_price), 0) AS revenue FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.status NOT IN ('Cancelled', 'Returned') GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 8`, limit: 8 } }),
      w({ type: 'text', title: 'About this dashboard', size: 3, config: { body: 'Every chart here is a SQL query over the raw tables listed in the semantic model, run through the same guard as the SQL workspace. Open a widget in edit mode to see or change its query.' } }),
    ],
  }
  return [overview, revenue, retention, products]
}

function scoreLabelText(name: string) {
  const l = scoreLabel(name)
  return l.charAt(0).toUpperCase() + l.slice(1)
}

const TYPE_ICON: Record<Widget['type'], LucideIcon> = { metric: Hash, segment: Shapes, distribution: Gauge, chart: BarChart3, table: Table2, text: AlignLeft }

/** A miniature of the dashboard's grid: each widget at its real width and height, drawn as a glyph. */
function Thumb({ widgets }: { widgets: Widget[] }) {
  if (!widgets.length) {
    return <div className="grid h-full place-items-center text-[12px] text-faint">Empty</div>
  }
  return (
    <div className="grid grid-flow-dense auto-rows-[14px] grid-cols-3 gap-1.5">
      {widgets.slice(0, 12).map((w) => (
        <div key={w.id} className={cx('flex overflow-hidden rounded-[5px] border border-line bg-surface p-1.5 shadow-[0_1px_1px_rgb(10_35_80/0.04)]',
          ['col-span-1', 'col-span-2', 'col-span-3'][w.size - 1], ['row-span-1', 'row-span-2', 'row-span-3'][rowSpan(w) - 1])}>
          <Glyph w={w} />
        </div>
      ))}
    </div>
  )
}

function Glyph({ w }: { w: Widget }) {
  if (w.type === 'metric' || w.type === 'segment') {
    return <span className="flex w-full items-center gap-1"><span className="h-1 w-1/3 rounded-full bg-line-strong" /><span className="ml-auto h-1.5 w-1/4 rounded-full bg-[var(--chart-1)] opacity-70" /></span>
  }
  if (w.type === 'text') return <span className="flex w-full flex-col justify-center gap-1"><span className="h-1 w-4/5 rounded-full bg-line" /><span className="h-1 w-3/5 rounded-full bg-line" /></span>
  if (w.type === 'table') {
    return <span className="flex w-full flex-col gap-[5px] pt-0.5">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="flex gap-1"><span className="h-1 flex-1 rounded-full bg-line" /><span className="h-1 rounded-full bg-[var(--chart-1)] opacity-40" style={{ width: `${40 - i * 6}%` }} /></span>)}</span>
  }
  const kind = w.type === 'chart' ? w.config.kind : 'bar'
  const c = w.type === 'chart' ? `var(--chart-${w.config.color ?? 1})` : 'var(--chart-1)'
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-full w-full">
      {kind === 'pie' ? (
        <g transform="translate(50 20)">
          <circle r="15" fill="none" stroke={c} strokeWidth="7" strokeDasharray="40 100" opacity="0.85" />
          <circle r="15" fill="none" stroke="var(--chart-2)" strokeWidth="7" strokeDasharray="28 100" strokeDashoffset="-41" opacity="0.85" />
          <circle r="15" fill="none" stroke="var(--chart-3)" strokeWidth="7" strokeDasharray="25 100" strokeDashoffset="-70" opacity="0.85" />
        </g>
      ) : kind === 'line' || kind === 'area' ? (
        <>
          {kind === 'area' && <path d="M0 34 L14 26 L28 28 L42 18 L56 21 L70 12 L84 14 L100 6 V40 H0Z" fill={c} opacity="0.15" />}
          <path d="M0 34 L14 26 L28 28 L42 18 L56 21 L70 12 L84 14 L100 6" fill="none" stroke={c} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </>
      ) : kind === 'hbar' ? (
        [30, 26, 21, 15, 10].map((v, i) => <rect key={i} x="0" y={2 + i * 8} width={v * 3.2} height="5" rx="1.5" fill={c} opacity="0.8" />)
      ) : (
        [14, 22, 30, 26, 36, 20, 28, 33].map((v, i) => <rect key={i} x={2 + i * 12.4} y={40 - v} width="8" height={v} rx="1.5" fill={c} opacity="0.8" />)
      )}
    </svg>
  )
}

function DashboardList() {
  const fetchAll = useServerFn(listDashboards)
  const create = useServerFn(createDashboard)
  const navigate = useNavigate()
  const { config } = useConfig()
  const toast = useToast()
  const { can } = useMe()
  const [items, setItems] = useState<Dashboard[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    fetchAll().then(setItems).catch((e) => toast({ title: 'Could not load dashboards', description: (e as Error).message, tone: 'danger' }))
  }, [fetchAll, toast])

  const make = async (name: string, description: string, widgets: Widget[]) => {
    setBusy(true)
    try {
      const d = await create({ data: { name, description, widgets } })
      navigate({ to: '/dashboards/$id', params: { id: d.id }, search: widgets.length ? {} : { edit: true } })
    } catch (e) {
      toast({ title: 'Not created', description: (e as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  // Creates the four sample dashboards, then opens the first.
  const makeSamples = async () => {
    setBusy(true)
    try {
      const labels = Object.fromEntries((config?.segments ?? []).map((x) => [x.name, x.label ?? x.name]))
      let first: string | null = null
      for (const sample of sampleDashboards(labels)) {
        const d = await create({ data: sample })
        first ??= d.id
      }
      toast({ title: 'Sample dashboards created', description: 'Customer overview, Revenue, Retention and Products.', tone: 'success' })
      if (first) navigate({ to: '/dashboards/$id', params: { id: first }, search: {} })
    } catch (e) {
      toast({ title: 'Not created', description: (e as Error).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const shown = (items ?? []).filter((d) => !q || `${d.name} ${d.description}`.toLowerCase().includes(q.toLowerCase()))
  const recent = items?.length ? items.reduce((a, b) => (b.updated_at > a.updated_at ? b : a)) : null

  return (
    <>
      <PageHeader
        title="Dashboards"
        description={items?.length ? `${items.length} saved · last edited ${when(recent!.updated_at)}` : 'Saved views of your data.'}
        actions={can('editor') && (
          <>
            {items && items.length > 0 && <Button variant="ghost" loading={busy} onClick={makeSamples}>Add the samples</Button>}
            <Button variant="primary" icon={<Plus />} loading={busy} onClick={() => make('New dashboard', '', [])}>New dashboard</Button>
          </>
        )}
      />
      {items && items.length > 3 && (
        <div className="relative mb-5 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dashboard" aria-label="Find a dashboard" className="pl-8" />
        </div>
      )}
      {!items ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      ) : items.length === 0 ? (
        <Empty
          icon={<LayoutDashboard />}
          title="No dashboards yet"
          action={can('editor') && (
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" loading={busy} onClick={makeSamples}>Create the sample dashboards</Button>
              <Button loading={busy} onClick={() => make('New dashboard', '', [])}>Start empty</Button>
            </div>
          )}
        >
          {can('editor') ? 'Four samples built on the demo data, or a blank page.' : 'An editor can create one.'}
        </Empty>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-muted">No dashboard matches “{q}”.</p>
      ) : (
        <div className="anim-stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((d, i) => {
            const types = [...new Set(d.widgets.map((w) => w.type))]
            return (
              <Link
                key={d.id}
                to="/dashboards/$id"
                params={{ id: d.id }}
                style={{ ['--i' as string]: i }}
                className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card-hover"
              >
                <div className="relative h-36 overflow-hidden border-b border-line bg-gradient-to-b from-subtle to-bg p-3">
                  <div className="transition-transform duration-300 group-hover:scale-[1.02]"><Thumb widgets={d.widgets} /></div>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg to-transparent" />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="flex items-center gap-1.5 text-[14px] font-semibold">
                    <span className="truncate">{d.name}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                  </h2>
                  {d.description && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">{d.description}</p>}
                  <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-[12px] text-faint">
                    <span className="flex items-center gap-1.5">
                      {types.map((t) => {
                        const I = TYPE_ICON[t]
                        return <I key={t} className="size-3.5" aria-hidden />
                      })}
                      <span className="ml-0.5">{d.widgets.length} widget{d.widgets.length === 1 ? '' : 's'}</span>
                    </span>
                    <span>{when(d.updated_at)}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </>
  )
}
