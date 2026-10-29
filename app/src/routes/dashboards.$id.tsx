import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ArrowLeft, ArrowRight, Copy, GripVertical, LayoutDashboard, Link2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { WidgetPanel } from '~/components/dashboard/WidgetPanel'
import { DashboardContext, ExpandedWidget, ROW_CLASS, SIZE_CLASS, WidgetView, rowSpan } from '~/components/dashboard/widgets'
import { useToast } from '~/components/ui/Toaster'
import { Badge, Button, ConfirmButton, Empty, Select, Skeleton, Tabs, cx } from '~/components/ui'
import { ZeroShell } from '~/components/layout/ZeroShell'
import { useMe } from '~/lib/session'
import { createDashboard, deleteDashboard, getDashboard, listDashboards, updateDashboard, type Dashboard, type Widget } from '~/server/dashboards'

export const Route = createFileRoute('/dashboards/$id')({
  validateSearch: z.object({ edit: z.boolean().optional() }),
  component: DashboardPage,
})

const GRID = 'grid auto-rows-[120px] gap-4 md:grid-cols-3'
const AUTO = [
  { value: '0', label: 'Auto-refresh off' },
  { value: '60000', label: 'Every minute' },
  { value: '300000', label: 'Every 5 minutes' },
  { value: '900000', label: 'Every 15 minutes' },
]
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const when = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const newId = () => Math.random().toString(36).slice(2, 10)

function DashboardPage() {
  const { id } = Route.useParams()
  const { edit: startEditing } = Route.useSearch()
  const fetchOne = useServerFn(getDashboard)
  const fetchAll = useServerFn(listDashboards)
  const create = useServerFn(createDashboard)
  const update = useServerFn(updateDashboard)
  const remove = useServerFn(deleteDashboard)
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useMe()
  const [saved, setSaved] = useState<Dashboard | null | undefined>(undefined)
  const [all, setAll] = useState<Dashboard[]>([])
  const [draft, setDraft] = useState<Dashboard | null>(null)
  const [editing, setEditing] = useState(!!startEditing && can('editor'))
  const [panel, setPanel] = useState<{ widget: Widget | null } | null>(null)
  const [expanded, setExpanded] = useState<Widget | null>(null)
  const [saving, setSaving] = useState(false)
  const [tick, setTick] = useState(0)
  const [refreshedAt, setRefreshedAt] = useState(() => new Date())
  const [auto, setAuto] = useState('0')
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)

  useEffect(() => {
    setSaved(undefined)
    setDraft(null)
    fetchOne({ data: { id } }).then(setSaved).catch((e) => toast({ title: 'Could not load', description: (e as Error).message, tone: 'danger' }))
  }, [id, fetchOne, toast])
  useEffect(() => {
    fetchAll().then(setAll).catch(() => {})
  }, [fetchAll])

  const refreshAll = useCallback(() => {
    setTick((t) => t + 1)
    setRefreshedAt(new Date())
  }, [])
  useEffect(() => {
    const ms = Number(auto)
    if (!ms || editing) return
    const t = setInterval(refreshAll, ms)
    return () => clearInterval(t)
  }, [auto, editing, refreshAll])

  const current = draft ?? saved
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved)
  const change = (patch: (d: Dashboard) => Dashboard) => setDraft((d) => patch(d ?? (saved as Dashboard)))

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const r = await update({ data: { id, name: draft.name, description: draft.description, widgets: draft.widgets } })
      if ('error' in r) throw new Error(r.error)
      setSaved(r)
      setDraft(null)
      setAll((xs) => xs.map((x) => (x.id === r.id ? r : x)))
      toast({ title: 'Dashboard saved', tone: 'success' })
    } catch (e) {
      toast({ title: 'Not saved', description: (e as Error).message, tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async () => {
    if (!current) return
    try {
      const d = await create({ data: { name: `${current.name} (copy)`, description: current.description, widgets: current.widgets.map((w) => ({ ...w, id: newId() })) } })
      toast({ title: 'Dashboard duplicated', tone: 'success' })
      navigate({ to: '/dashboards/$id', params: { id: d.id }, search: {} })
    } catch (e) {
      toast({ title: 'Not duplicated', description: (e as Error).message, tone: 'danger' })
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href.split('?')[0])
      toast({ title: 'Link copied', tone: 'success' })
    } catch {
      toast({ title: 'Could not copy the link', tone: 'danger' })
    }
  }

  const closePanel = useCallback(() => setPanel(null), [])
  const closeExpanded = useCallback(() => setExpanded(null), [])
  const upsertWidget = (w: Widget) => {
    change((d) => ({ ...d, widgets: d.widgets.some((x) => x.id === w.id) ? d.widgets.map((x) => (x.id === w.id ? w : x)) : [...d.widgets, w] }))
    setPanel(null)
  }
  const moveWidget = (from: number, to: number) =>
    change((d) => {
      if (to < 0 || to >= d.widgets.length || from === to) return d
      const ws = [...d.widgets]
      const [w] = ws.splice(from, 1)
      ws.splice(to, 0, w)
      return { ...d, widgets: ws }
    })

  const ctx = useMemo(() => ({ tick, editing, expand: setExpanded }), [tick, editing])

  if (saved === undefined) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <div className={GRID}>{[1, 1, 1, 3, 3].map((r, i) => <Skeleton key={i} className={cx('rounded-xl', ROW_CLASS[r as 1 | 3], r === 3 && i === 3 && 'md:col-span-2')} />)}</div>
      </div>
    )
  }
  if (saved === null || !current) {
    return <Empty icon={<LayoutDashboard />} title="No such dashboard" action={<Button onClick={() => navigate({ to: '/dashboards' })}>All dashboards</Button>} />
  }

  return (
    <div className={cx(editing && 'pb-24')}>
      {/* Header: name and meta on the left, view controls on the right. In edit mode the name becomes an input. */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <input value={current.name} aria-label="Dashboard name" placeholder="Name"
                onChange={(e) => change((d) => ({ ...d, name: e.target.value }))}
                className="-ml-2 w-full max-w-xl rounded-md bg-transparent px-2 py-0.5 text-[22px] font-semibold tracking-tight outline-none ring-line hover:ring-1 focus:ring-2 focus:ring-accent/40" />
              <input value={current.description} aria-label="Description" placeholder="What this dashboard is for"
                onChange={(e) => change((d) => ({ ...d, description: e.target.value }))}
                className="-ml-2 mt-0.5 w-full max-w-2xl rounded-md bg-transparent px-2 py-0.5 text-[13px] text-muted outline-none ring-line placeholder:text-faint hover:ring-1 focus:ring-2 focus:ring-accent/40" />
            </>
          ) : (
            <>
              <h1 className="truncate text-[22px] font-semibold tracking-tight">{current.name}</h1>
              {current.description && <p className="mt-0.5 text-[13px] text-muted">{current.description}</p>}
            </>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
            <span>{current.widgets.length} widget{current.widgets.length === 1 ? '' : 's'}</span>
            <span aria-hidden>·</span>
            <span>Edited {when(saved.updated_at)}</span>
            {!editing && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className={cx('size-1.5 rounded-full', auto !== '0' ? 'animate-pulse bg-success' : 'bg-line-strong')} />
                  Refreshed {clock(refreshedAt)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <ConfirmButton variant="ghost" icon={<Trash2 />} confirmLabel="Delete dashboard" onConfirm={async () => {
                await remove({ data: { id } })
                toast({ title: 'Dashboard deleted', tone: 'success' })
                navigate({ to: '/dashboards' })
              }}>Delete</ConfirmButton>
              <Button icon={<Plus />} onClick={() => setPanel({ widget: null })}>Add widget</Button>
            </>
          ) : (
            <>
              <Select value={auto} onChange={(e) => setAuto(e.target.value)} aria-label="Auto-refresh" className="h-8 !w-[168px] text-[12.5px]">
                {AUTO.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
              <Button icon={<RefreshCw />} onClick={refreshAll}>Refresh</Button>
              <Button variant="ghost" icon={<Link2 />} aria-label="Copy link" title="Copy link" onClick={copyLink} />
              {can('editor') && <Button variant="ghost" icon={<Copy />} aria-label="Duplicate" title="Duplicate" onClick={duplicate} />}
            </>
          )}
          {can('editor') && (
            <Tabs value={editing ? 'edit' : 'view'} onChange={(v) => setEditing(v === 'edit')}
              options={[{ value: 'view', label: 'View' }, { value: 'edit', label: 'Edit' }]} />
          )}
        </div>
      </div>

      {/* Switch between dashboards without going back to the list. */}
      {all.length > 1 && !editing && (
        <nav aria-label="Dashboards" className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1">
          {all.map((d) => (
            <Link key={d.id} to="/dashboards/$id" params={{ id: d.id }} search={{}}
              className={cx('-mb-px shrink-0 border-b-2 px-3 pb-2 pt-1 text-[13px] transition-colors',
                d.id === id ? 'border-brand font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>
              {d.name}
            </Link>
          ))}
        </nav>
      )}

      {current.widgets.length === 0 ? (
        <Empty icon={<LayoutDashboard />} title="No widgets yet"
          action={can('editor') && <Button variant="primary" icon={<Plus />} onClick={() => { setEditing(true); setPanel({ widget: null }) }}>Add a widget</Button>}>
          {can('editor') ? 'Add a metric, chart or table to get started.' : 'An editor can add widgets.'}
        </Empty>
      ) : (
        <ZeroShell fallback={<div className={GRID}>{current.widgets.map((w) => <Skeleton key={w.id} className={cx('rounded-xl', SIZE_CLASS[w.size], ROW_CLASS[rowSpan(w)])} />)}</div>}>
          <DashboardContext value={ctx}>
            {/* View mode packs small tiles into gaps; edit mode keeps the saved order so moves are predictable. */}
            <div className={cx(GRID, 'anim-stagger', !editing && 'grid-flow-dense')}>
              {current.widgets.map((w, i) => (
                <div
                  key={w.id}
                  className={cx('group/e relative min-w-0', SIZE_CLASS[w.size], ROW_CLASS[rowSpan(w)],
                    editing && 'rounded-xl outline-1 outline-dashed outline-offset-4 outline-line-strong',
                    drag?.from === i && 'opacity-40',
                    drag && drag.over === i && drag.from !== i && 'outline-2 outline-solid outline-accent')}
                  style={{ ['--i' as string]: i }}
                  draggable={editing}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    setDrag({ from: i, over: i })
                  }}
                  onDragOver={(e) => {
                    if (!drag) return
                    e.preventDefault()
                    if (drag.over !== i) setDrag({ ...drag, over: i })
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (drag) moveWidget(drag.from, i)
                    setDrag(null)
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <WidgetView widget={w} />
                  {editing && <EditBar w={w} i={i} last={current.widgets.length - 1} onMove={moveWidget} onEdit={() => setPanel({ widget: w })}
                    onSize={(s) => change((d) => ({ ...d, widgets: d.widgets.map((x) => (x.id === w.id ? { ...x, size: s } : x)) }))}
                    onDelete={() => change((d) => ({ ...d, widgets: d.widgets.filter((x) => x.id !== w.id) }))} />}
                </div>
              ))}
              {editing && (
                <button onClick={() => setPanel({ widget: null })}
                  className="row-span-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-[13px] text-muted transition-colors hover:border-accent hover:bg-accent-subtle hover:text-accent">
                  <Plus className="size-4" /> Add widget
                </button>
              )}
            </div>
          </DashboardContext>
        </ZeroShell>
      )}

      {panel && (
        <ZeroShell fallback={null}>
          <WidgetPanel initial={panel.widget} onSave={upsertWidget} onClose={closePanel} />
        </ZeroShell>
      )}
      {expanded && (
        <ZeroShell fallback={null}>
          <ExpandedWidget widget={expanded} onClose={closeExpanded} />
        </ZeroShell>
      )}

      {(dirty || saving) && (
        <div className="anim-rise fixed bottom-5 left-1/2 z-30 -translate-x-1/2 lg:ml-[calc(var(--sidebar-w,15rem)/2)]">
          <div className="flex items-center gap-4 rounded-lg border border-line bg-surface py-2 pl-4 pr-2 shadow-xl">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="size-1.5 rounded-full bg-warning" />
              <span>Unsaved changes</span>
              <Badge>{current.widgets.length} widget{current.widgets.length === 1 ? '' : 's'}</Badge>
            </div>
            <div className="flex gap-1.5">
              <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
              <Button variant="primary" loading={saving} disabled={!current.name.trim()} onClick={save}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The floating controls on a widget in edit mode. Drag the grip, or use the arrows from the keyboard. */
function EditBar({ w, i, last, onMove, onEdit, onSize, onDelete }: {
  w: Widget; i: number; last: number
  onMove: (from: number, to: number) => void; onEdit: () => void; onSize: (s: 1 | 2 | 3) => void; onDelete: () => void
}) {
  return (
    <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 opacity-0 shadow-md transition-opacity focus-within:opacity-100 group-hover/e:opacity-100">
      <span className="grid size-7 cursor-grab place-items-center text-faint active:cursor-grabbing" title="Drag to move"><GripVertical className="size-3.5" /></span>
      <Button variant="ghost" size="sm" aria-label="Move earlier" icon={<ArrowLeft />} disabled={i === 0} onClick={() => onMove(i, i - 1)} />
      <Button variant="ghost" size="sm" aria-label="Move later" icon={<ArrowRight />} disabled={i === last} onClick={() => onMove(i, i + 1)} />
      <span className="mx-0.5 flex items-center" role="group" aria-label="Width">
        {([1, 2, 3] as const).map((s) => (
          <button key={s} onClick={() => onSize(s)}
            className={cx('h-6 w-6 rounded text-[11px] font-medium', w.size === s ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-hover')}
            aria-pressed={w.size === s} aria-label={`${s} of 3 columns`}>
            {s}
          </button>
        ))}
      </span>
      <Button variant="ghost" size="sm" aria-label="Edit widget" icon={<Pencil />} onClick={onEdit} />
      <ConfirmButton variant="ghost" size="sm" aria-label="Delete widget" icon={<Trash2 />} confirmLabel="Delete" onConfirm={onDelete} />
    </div>
  )
}
