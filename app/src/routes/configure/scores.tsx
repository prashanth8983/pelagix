import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { DetailHeader, Group, MasterDetail, type ListItem } from '~/components/config/MasterDetail'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useSection } from '~/components/config/state'
import { formatValue } from '~/components/ui/format'
import { SqlBlock, SqlEditor } from '~/components/sql/Sql'
import { Badge, Button, Code, DataTable, ErrorList, Field, Input, Select, Switch, Tabs, cx } from '~/components/ui'
import { clean, errorsAt, move, remove, replace, uniqueName } from '~/lib/edit'
import { FORMATS, type Score, type ScoresCfg } from '~/lib/types'
import { previewScores, type ScoresPreview } from '~/server/config'

export const Route = createFileRoute('/configure/scores')({
  validateSearch: z.object({ item: z.union([z.string(), z.number()]).transform(String).optional() }),
  component: ScoresPage,
})

const FORMAT_HELP: Record<string, string> = {
  number: 'Plain number', money: 'US dollars', count: 'Whole number', ratio: '0 to 1, shown as a percentage',
  percent: 'Already a percentage', days: 'Number of days', date: 'A date or timestamp', text: 'Text, not filterable',
}

function ScoresPage() {
  const editor = useSection('scores')
  const { item } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const run = useServerFn(previewScores)
  const [preview, setPreview] = useState<ScoresPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [baseOpen, setBaseOpen] = useState(false)
  const cfg = editor.value
  const errs = editor.errors

  const doPreview = async (scores?: ScoresCfg) => {
    setBusy(true)
    try {
      const r = await run({ data: { scores } })
      setPreview('errors' in r && !('sql' in r) ? { sql: '', plan: [], errors: r.errors } : (r as ScoresPreview))
    } catch (e) {
      setPreview({ sql: '', plan: [], error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    doPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cfg) return <SectionFrame section="scores" title="Scores" editor={editor}><></></SectionFrame>

  const scores = cfg.scores
  const i = Math.min(Number(item ?? 0) || 0, Math.max(scores.length - 1, 0))
  const selected = scores.length ? String(i) : null
  const select = (key: string) => navigate({ search: { item: key }, replace: true })
  const set = (patch: (c: ScoresCfg) => ScoresCfg) => editor.set((c) => patch(c))
  const setScore = (s: Score) => set((c) => ({ ...c, scores: replace(c.scores, i, clean(s)) }))
  const deps = Object.fromEntries((preview?.plan ?? []).map((p) => [p.name, p]))
  const add = () => {
    set((c) => ({ ...c, scores: [...c.scores, { name: uniqueName(c.scores.map((s) => s.name), 'new_score'), sql: 'COUNT(*)', format: 'number' }] }))
    select(String(scores.length))
  }

  const items: ListItem[] = scores.map((s, j) => {
    const d = deps[s.name]
    const bad = errorsAt(errs, `scores.${j}`)
    return {
      key: String(j),
      title: <span className="font-mono">{s.name}</span>,
      subtitle: s.label ? `${s.label} · ${s.sql}` : s.sql,
      badge: bad ? 'invalid' : d ? (d.layer === 0 ? (s.from ? 'own source' : 'aggregate') : `uses ${d.depends_on.length}`) : undefined,
      tone: bad ? 'danger' : d && d.layer > 0 ? 'accent' : 'neutral',
      text: `${s.name} ${s.label ?? ''} ${s.sql}`,
    }
  })
  const s = scores[i]
  const d = s ? deps[s.name] : undefined
  const where = cfg.where?.trim()

  return (
    <SectionFrame section="scores" title="Scores" editor={editor} actions={<Button icon={<Plus />} onClick={add}>New score</Button>}>
      {/* Base query: collapsed to one line unless being edited */}
      <section className="mb-5 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <button type="button" onClick={() => setBaseOpen(!baseOpen)} aria-expanded={baseOpen}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-hover">
          <ChevronRight className={cx('size-4 shrink-0 text-faint transition-transform', baseOpen && 'rotate-90')} />
          <span className="text-[13px] font-semibold">Base query</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
            FROM {cfg.from.replace(/\s+/g, ' ').trim()}{where ? ` WHERE ${where}` : ''} GROUP BY {cfg.key_expr}
          </span>
          {(errorsAt(errs, 'from') || errorsAt(errs, 'key_expr')) && <Badge tone="danger">invalid</Badge>}
        </button>
        {baseOpen && (
          <div className="anim-fade space-y-4 border-t border-line p-4">
            <p className="text-[12px] text-muted">The rows aggregate scores read, unless a score names its own table.</p>
            <Field label="FROM" hint="Tables and joins" error={errorsAt(errs, 'from')}>
              <Code value={cfg.from} rows={3} onChange={(e) => set((c) => ({ ...c, from: e.target.value }))} />
            </Field>
            <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
              <Field label="WHERE" hint="Optional row filter">
                <Code value={cfg.where ?? ''} rows={1} onChange={(e) => set((c) => clean({ ...c, where: e.target.value }))} />
              </Field>
              <Field label="Key expression" hint="Rows are grouped by this" error={errorsAt(errs, 'key_expr')}>
                <Input className="font-mono" value={cfg.key_expr} onChange={(e) => set((c) => ({ ...c, key_expr: e.target.value }))} />
              </Field>
            </div>
          </div>
        )}
      </section>

      <MasterDetail
        items={items}
        selected={selected}
        onSelect={select}
        onNew={add}
        newLabel="New score"
        searchPlaceholder="Search scores"
        emptyTitle="No scores yet"
        emptyHint="Add a SQL aggregate over the base query, such as COUNT(*) or SUM(amount)."
      >
        {s && (
          <>
            <DetailHeader
              title={<span className="font-mono">{s.name}</span>}
              subtitle={d ? (d.layer === 0 ? (s.from ? 'Aggregates its own table' : 'Aggregates the base query') : `Layer ${d.layer}, uses ${d.depends_on.join(', ')}`) : undefined}
              onUp={i > 0 ? () => set((c) => ({ ...c, scores: move(c.scores, i, -1) })) : undefined}
              onDown={i < scores.length - 1 ? () => set((c) => ({ ...c, scores: move(c.scores, i, 1) })) : undefined}
              onDuplicate={() => {
                set((c) => ({ ...c, scores: [...c.scores, { ...s, name: uniqueName(c.scores.map((x) => x.name), s.name) }] }))
                select(String(scores.length))
              }}
              onRemove={() => {
                set((c) => ({ ...c, scores: remove(c.scores, i) }))
                select(String(Math.max(0, i - 1)))
              }}
            />

            <Group title="Definition" help="The column name in the score table, how it is shown, and the SQL that computes it.">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Name" hint="Column name" error={errorsAt(errs, `scores.${i}.name`)}>
                  <Input className="font-mono" value={s.name} onChange={(e) => setScore({ ...s, name: e.target.value })} />
                </Field>
                <Field label="Label" hint="Shown in the app">
                  <Input value={s.label ?? ''} onChange={(e) => setScore({ ...s, label: e.target.value })} />
                </Field>
                <Field label="Format" hint={FORMAT_HELP[s.format ?? 'number']}>
                  <Select value={s.format ?? 'number'} onChange={(e) => setScore({ ...s, format: e.target.value as Score['format'] })}>
                    {FORMATS.map((f) => <option key={f}>{f}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="SQL" className="mt-4" error={errorsAt(errs, `scores.${i}.sql`)}
                hint={d?.depends_on.length ? `Uses ${d.depends_on.join(', ')}` : s.from ? 'An aggregate over the table below' : 'An aggregate, or a formula using other scores'}>
                <SqlEditor value={s.sql} minRows={2} onChange={(v) => setScore({ ...s, sql: v })} />
              </Field>
            </Group>

            <Group title="Behaviour" help="What entities with no rows get, and whether the score ranks across all entities.">
              <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
                <Field label="Default" hint="For entities with no rows">
                  <Input type="number" step="any" value={s.default ?? ''} onChange={(e) => setScore({ ...s, default: e.target.value === '' ? null : Number(e.target.value) })} />
                </Field>
                <div className="flex flex-col gap-3 pt-1 md:pt-6">
                  <div><Switch checked={!!s.window} onChange={(v) => setScore({ ...s, window: v || undefined })} label="Window function, e.g. NTILE" /></div>
                  <div><Switch checked={!!s.from} label="Use its own table"
                    onChange={(v) => setScore(v ? { ...s, from: s.from || 'other_table t', key_expr: s.key_expr || 't.entity_id' } : { ...s, from: undefined, where: undefined, key_expr: undefined })} /></div>
                </div>
              </div>
              {!!s.from && (
                <div className="anim-fade mt-4 grid gap-3 rounded-lg border border-line bg-subtle/40 p-3 md:grid-cols-[2fr_1fr]">
                  <Field label="FROM" hint="Table and joins this score reads">
                    <Code value={s.from ?? ''} rows={2} onChange={(e) => setScore({ ...s, from: e.target.value })} />
                  </Field>
                  <Field label="Key expression" hint="Must produce the entity key">
                    <Input className="font-mono" value={s.key_expr ?? ''} placeholder="t.customer_id" onChange={(e) => setScore({ ...s, key_expr: e.target.value })} />
                  </Field>
                  <Field label="WHERE" hint="Optional row filter" className="md:col-span-2">
                    <Code value={s.where ?? ''} rows={1} onChange={(e) => setScore({ ...s, where: e.target.value || undefined })} />
                  </Field>
                </div>
              )}
            </Group>

            <Group title="Description" help="Shown in the entity drawer and given to the agent as the column's meaning.">
              <Input value={s.description ?? ''} placeholder="What this score measures and its unit" onChange={(e) => setScore({ ...s, description: e.target.value })} />
            </Group>
          </>
        )}
      </MasterDetail>

      <div className="mt-5">
        <PreviewPanel preview={preview} busy={busy} onRun={() => doPreview(editor.dirty ? cfg : undefined)} dirty={editor.dirty} scores={scores} />
      </div>
    </SectionFrame>
  )
}

function PreviewPanel({ preview, busy, onRun, dirty, scores }:
  { preview: ScoresPreview | null; busy: boolean; onRun: () => void; dirty: boolean; scores: Score[] }) {
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState<'graph' | 'sample' | 'stats' | 'sql'>('graph')
  const layers = Math.max(-1, ...(preview?.plan ?? []).map((p) => p.layer)) + 1
  const fmt = Object.fromEntries(scores.map((s) => [s.name, s.format]))
  const groups = new Set((preview?.plan ?? []).filter((p) => p.layer === 0).map((p) => p.group)).size

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight className={cx('size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
          <span className="text-[13px] font-semibold">Preview</span>
          <span className="truncate text-[12px] text-muted">Read-only preview.</span>
        </button>
        {open && (
          <Tabs value={tab} onChange={setTab} options={[
            { value: 'graph', label: 'Dependencies' }, { value: 'sample', label: 'Sample' }, { value: 'stats', label: 'Stats' }, { value: 'sql', label: 'SQL' },
          ]} />
        )}
        <Button variant={dirty ? 'primary' : 'secondary'} size="sm" onClick={onRun} disabled={busy} loading={busy}>{dirty ? 'Preview draft' : 'Refresh'}</Button>
      </div>
      {open && (
        <div className="anim-fade border-t border-line p-4">
          {preview?.errors && <ErrorList errors={preview.errors} />}
          {preview?.error && <p className="mb-3 whitespace-pre-wrap rounded-lg bg-danger-subtle p-3 font-mono text-[12px] text-danger">{preview.error}</p>}
          {!preview ? <p className="text-[13px] text-muted">Loading</p> : tab === 'graph' ? (
            <div className="space-y-3">
              {Array.from({ length: layers }).map((_, l) => (
                <div key={l}>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                    Layer {l}{l === 0 ? (groups > 1 ? ` · aggregates from ${groups} sources, joined on the key` : ' · aggregates') : ' · formulas over the layer above'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.plan.filter((p) => p.layer === l).map((p) => (
                      <span key={p.name} title={p.depends_on.length ? `uses ${p.depends_on.join(', ')}` : 'aggregate'}
                        className={cx('rounded-md border px-2 py-0.5 font-mono text-[11px]', l === 0 ? 'border-line' : 'border-accent/30 bg-accent-subtle text-accent')}>
                        {p.name}
                        {p.depends_on.length > 0 && <span className="text-faint"> · {p.depends_on.join(', ')}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : tab === 'sample' ? (
            preview.columns ? <DataTable columns={preview.columns} rows={preview.rows ?? []}
              format={(c, v) => (c === 'scored_at' ? '' : formatValue(fmt[c], v))} /> : null
          ) : tab === 'stats' ? (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-subtle text-left text-muted">
                  <tr><th className="px-2 py-1.5 font-medium">score</th><th className="px-2 py-1.5 text-right font-medium">min</th><th className="px-2 py-1.5 text-right font-medium">avg</th><th className="px-2 py-1.5 text-right font-medium">max</th><th className="px-2 py-1.5 text-right font-medium">null</th></tr>
                </thead>
                <tbody>
                  {(preview.stats ?? []).map((st) => {
                    const name = String(st.column_name)
                    const num = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? String(v ?? '—') : formatValue(fmt[name], Number(v)))
                    const nulls = Number(st.null_percentage ?? 0)
                    return (
                      <tr key={name} className="border-t border-line/70">
                        <td className="px-2 py-1.5 font-mono">{name}</td>
                        <td className="num px-2 py-1.5 text-right">{fmt[name] === 'date' ? String(st.min ?? '').slice(0, 10) : num(st.min)}</td>
                        <td className="num px-2 py-1.5 text-right">{fmt[name] === 'date' ? '' : num(st.avg)}</td>
                        <td className="num px-2 py-1.5 text-right">{fmt[name] === 'date' ? String(st.max ?? '').slice(0, 10) : num(st.max)}</td>
                        <td className={cx('num px-2 py-1.5 text-right', nulls > 0 ? 'text-warning' : 'text-muted')}>{nulls.toFixed(1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <SqlBlock sql={preview.sql} label="Scoring statement" openInWorkspace={false} maxHeight={480} />
          )}
        </div>
      )}
    </section>
  )
}
