// Add or edit one widget: pick a type, fill its form, preview it, save to the draft.
import { useQuery } from '@rocicorp/zero/react'
import { useServerFn } from '@tanstack/react-start'
import { AlignLeft, BarChart3, ChevronLeft, Gauge, Hash, Shapes, Table2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NUMERIC_SCORES } from '~/generated/project'
import type { QueryResult } from '~/lib/types'
import { runQuery } from '~/server/config'
import { FORMATS, WIDGET_TYPES, type Widget, type WidgetType } from '~/server/dashboards'
import { queries } from '~/zero/queries'
import { scoreLabel } from '~/components/ui/format'
import { SqlEditor } from '~/components/sql/Sql'
import { Button, Code, DataTable, Field, Input, Select, Tabs, cx } from '~/components/ui'
import { DistributionWidget, SimpleChart } from './widgets'

const TYPES: Record<WidgetType, { label: string; help: string; icon: LucideIcon }> = {
  metric: { label: 'Metric', help: 'One number from SQL.', icon: Hash },
  segment: { label: 'Segment size', help: 'A segment’s live size.', icon: Shapes },
  distribution: { label: 'Distribution', help: 'A histogram of one score across every entity.', icon: Gauge },
  chart: { label: 'Chart', help: 'A bar, line or area chart from a SQL query.', icon: BarChart3 },
  table: { label: 'Table', help: 'The first rows of a SQL query.', icon: Table2 },
  text: { label: 'Text', help: 'A note for the people reading the dashboard.', icon: AlignLeft },
}

const newId = () => Math.random().toString(36).slice(2, 10)

function blank(type: WidgetType): Widget {
  const base = { id: newId(), title: TYPES[type].label, size: (type === 'chart' || type === 'distribution' || type === 'table' ? 2 : 1) as 1 | 2 | 3 }
  switch (type) {
    case 'metric':
      return { ...base, type, config: { sql: '', format: 'number' } }
    case 'segment':
      return { ...base, type, config: { segment: '' } }
    case 'distribution':
      return { ...base, type, config: { column: NUMERIC_SCORES[0] ?? '', bins: 20 } }
    case 'chart':
      return { ...base, type, config: { sql: '', kind: 'bar', x: '', y: '' } }
    case 'table':
      return { ...base, type, config: { sql: '', limit: 20 } }
    case 'text':
      return { ...base, type, config: { body: '' } }
  }
}

export function WidgetPanel({ initial, onSave, onClose }: { initial: Widget | null; onSave: (w: Widget) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Widget | null>(initial)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="anim-fade absolute inset-0 bg-overlay" />
      <aside
        role="dialog"
        aria-label={draft ? `${initial ? 'Edit' : 'New'} widget` : 'Choose a widget type'}
        onClick={(e) => e.stopPropagation()}
        className="anim-slide absolute inset-y-2 right-2 flex w-[calc(100%-1rem)] max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {draft && !initial && (
              <Button variant="ghost" size="sm" aria-label="Back to widget types" icon={<ChevronLeft />} onClick={() => setDraft(null)} />
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold">{!draft ? 'Add a widget' : initial ? 'Edit widget' : `New ${TYPES[draft.type].label.toLowerCase()}`}</h2>
              <p className="text-[12px] text-muted">{!draft ? 'Choose what it shows' : TYPES[draft.type].help}</p>
            </div>
          </div>
          <Button variant="ghost" aria-label="Close" icon={<X />} onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          {!draft ? <TypePicker onPick={(t) => setDraft(blank(t))} /> : <WidgetForm draft={draft} onChange={setDraft} />}
        </div>
        {draft && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!valid(draft)} onClick={() => onSave(draft)}>{initial ? 'Apply' : 'Add to dashboard'}</Button>
          </footer>
        )}
      </aside>
    </div>
  )
}

function valid(w: Widget): boolean {
  if (!w.title.trim()) return false
  switch (w.type) {
    case 'metric':
    case 'table':
      return w.config.sql.trim().length > 0
    case 'chart':
      return w.config.sql.trim().length > 0 && !!w.config.x && !!w.config.y
    case 'segment':
      return !!w.config.segment
    case 'distribution':
      return !!w.config.column
    case 'text':
      return true
  }
}

function TypePicker({ onPick }: { onPick: (t: WidgetType) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {WIDGET_TYPES.map((t) => {
        const T = TYPES[t]
        return (
          <button
            key={t}
            onClick={() => onPick(t)}
            className="flex items-start gap-3 rounded-lg border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-hover focus-visible:border-accent"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-subtle text-muted"><T.icon className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{T.label}</span>
              <span className="block text-[12px] text-muted">{T.help}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function WidgetForm({ draft: w, onChange }: { draft: Widget; onChange: (w: Widget) => void }) {
  const set = (patch: Partial<Widget>) => onChange({ ...w, ...patch } as Widget)
  const cfg = <T extends Widget>(patch: Partial<T['config']>) => onChange({ ...w, config: { ...w.config, ...patch } } as Widget)
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="Title">
          <Input value={w.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
        </Field>
        <Field label="Width">
          <Tabs value={String(w.size)} onChange={(v) => set({ size: Number(v) as 1 | 2 | 3 })}
            options={[{ value: '1', label: '1/3' }, { value: '2', label: '2/3' }, { value: '3', label: 'Full' }]} />
        </Field>
      </div>

      {w.type === 'segment' && <SegmentFields w={w} cfg={cfg} />}
      {w.type === 'distribution' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Score">
              <Select value={w.config.column} onChange={(e) => cfg({ column: e.target.value })}>
                {NUMERIC_SCORES.map((c) => <option key={c} value={c}>{scoreLabel(c)}</option>)}
              </Select>
            </Field>
            <Field label="Bins">
              <Input type="number" min={2} max={100} value={w.config.bins ?? 20} onChange={(e) => cfg({ bins: Math.max(2, Math.min(100, Number(e.target.value) || 20)) })} />
            </Field>
          </div>
          <Preview><DistributionWidget w={w} key={`${w.config.column}-${w.config.bins}`} /></Preview>
        </>
      )}
      {w.type === 'text' && (
        <Field label="Text" hint="Blank lines separate paragraphs">
          <Code rows={6} value={w.config.body} onChange={(e) => cfg({ body: e.target.value })} className="font-sans" />
        </Field>
      )}
      {(w.type === 'metric' || w.type === 'chart' || w.type === 'table') && <SqlFields w={w} cfg={cfg} />}
    </div>
  )
}

function SegmentFields({ w, cfg }: { w: Extract<Widget, { type: 'segment' }>; cfg: (p: Partial<{ segment: string }>) => void }) {
  const [rows] = useQuery(queries.segments.all())
  useEffect(() => {
    if (!w.config.segment && rows[0]) cfg({ segment: rows[0].name })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length])
  return (
    <Field label="Segment" hint="Sizes update as soon as a run publishes">
      <Select value={w.config.segment} onChange={(e) => cfg({ segment: e.target.value })}>
        {rows.length === 0 && <option value="">Loading segments…</option>}
        {rows.map((s) => <option key={s.name} value={s.name}>{s.label ?? s.name} ({s.size ?? 0})</option>)}
      </Select>
    </Field>
  )
}

function SqlFields({ w, cfg }: { w: Extract<Widget, { type: 'metric' | 'chart' | 'table' }>; cfg: (p: Record<string, unknown>) => void }) {
  const run = useServerFn(runQuery)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = async () => {
    if (!w.config.sql.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await run({ data: { sql: w.config.sql } })
      setResult(r)
      if (w.type === 'chart' && (!w.config.x || !w.config.y)) {
        const numeric = r.columns.filter((_, j) => r.rows.some((row) => typeof row[j] === 'number'))
        cfg({ x: w.config.x || r.columns.find((c) => !numeric.includes(c)) || r.columns[0] || '', y: w.config.y || numeric[0] || r.columns[1] || '' })
      }
    } catch (e) {
      setResult(null)
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const numericCols = result ? result.columns.filter((_, j) => result.rows.some((row) => typeof row[j] === 'number')) : []
  return (
    <>
      <Field label="SQL" hint="One read-only SELECT">
        <SqlEditor value={w.config.sql} minRows={5} onChange={(v) => cfg({ sql: v })} onRun={preview} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {w.type === 'metric' && (
          <Field label="Format">
            <Select value={w.config.format ?? 'number'} onChange={(e) => cfg({ format: e.target.value })}>
              {FORMATS.map((f) => <option key={f}>{f}</option>)}
            </Select>
          </Field>
        )}
        {w.type === 'table' && (
          <Field label="Rows shown">
            <Input type="number" min={1} max={500} value={w.config.limit ?? 20} onChange={(e) => cfg({ limit: Math.max(1, Math.min(500, Number(e.target.value) || 20)) })} />
          </Field>
        )}
        {w.type === 'chart' && (
          <>
            <Field label="Kind">
              <Select value={w.config.kind} onChange={(e) => cfg({ kind: e.target.value })}>
                <option value="bar">Bars</option><option value="hbar">Horizontal bars</option><option value="line">Line</option>
                <option value="area">Area</option><option value="pie">Donut</option>
              </Select>
            </Field>
            <Field label="Color" hint={w.config.kind === 'pie' ? 'The first slice; the rest follow the palette' : undefined}>
              <div className="flex h-8 items-center gap-1.5">
                {[1, 2, 3, 4, 5, 6].map((c) => (
                  <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => cfg({ color: c })}
                    className={`size-6 rounded-full border-2 transition-transform hover:scale-110 ${(w.config.color ?? 1) === c ? 'border-fg' : 'border-transparent'}`}
                    style={{ background: `var(--chart-${c})` }} />
                ))}
                {(w.config.kind === 'bar' || w.config.kind === 'hbar') && (
                  <label className="ml-3 flex items-center gap-1.5 text-[12px] text-muted">
                    <input type="checkbox" checked={!!w.config.perCategory} onChange={(e) => cfg({ perCategory: e.target.checked || undefined })} />
                    One color per bar
                  </label>
                )}
              </div>
            </Field>
            <Field label="X axis" hint={result ? undefined : 'Run a preview to choose columns'}>
              <Select value={w.config.x} disabled={!result} onChange={(e) => cfg({ x: e.target.value })}>
                {!result && <option value={w.config.x}>{w.config.x || 'Column'}</option>}
                {result?.columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Y axis">
              <Select value={w.config.y} disabled={!result} onChange={(e) => cfg({ y: e.target.value })}>
                {!result && <option value={w.config.y}>{w.config.y || 'Column'}</option>}
                {(numericCols.length ? numericCols : result?.columns ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={preview} loading={busy} disabled={!w.config.sql.trim()}>Preview</Button>
        <span className="text-[12px] text-muted">Preview</span>
      </div>
      {error && <p className="font-mono text-[12px] text-danger">{error}</p>}
      {result && (
        <Preview>
          {w.type === 'metric' ? (
            <p className="num text-[30px] font-semibold tracking-tight">{String(result.rows[0]?.[0] ?? '—')}</p>
          ) : w.type === 'chart' && w.config.x && w.config.y ? (
            <SimpleChart kind={w.config.kind} result={result} x={w.config.x} y={w.config.y} color={w.config.color} perCategory={w.config.perCategory} />
          ) : (
            <DataTable columns={result.columns} rows={result.rows} max={w.type === 'table' ? w.config.limit ?? 20 : 10} />
          )}
        </Preview>
      )}
    </>
  )
}

function Preview({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx('rounded-lg border border-dashed border-line p-3')}>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Preview</p>
      {children}
    </div>
  )
}
