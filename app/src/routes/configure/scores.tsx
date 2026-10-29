import { Plus } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { ItemCard } from '~/components/config/ItemCard'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useSection } from '~/components/config/state'
import { formatValue } from '~/components/format'
import { Badge, Button, Card, Code, DataTable, ErrorList, Field, Input, Pre, Select, Tabs, Switch } from '~/components/ui'
import { SqlBlock, SqlEditor } from '~/components/Sql'
import { clean, move, remove, replace, uniqueName } from '~/lib/edit'
import { FORMATS, type Score, type ScoresCfg } from '~/lib/types'
import { previewScores, type ScoresPreview } from '~/server/config'

export const Route = createFileRoute('/configure/scores')({ component: ScoresPage })

function ScoresPage() {
  const editor = useSection('scores')
  const run = useServerFn(previewScores)
  const [open, setOpen] = useState<number | null>(null)
  const [preview, setPreview] = useState<ScoresPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const cfg = editor.value

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

  if (!cfg) return <SectionFrame section="scores" title="Scores" editor={editor} description=""><></></SectionFrame>

  const set = (patch: (c: ScoresCfg) => ScoresCfg) => editor.set((c) => patch(c))
  const setScore = (i: number, s: Score) => set((c) => ({ ...c, scores: replace(c.scores, i, clean(s)) }))
  const deps = Object.fromEntries((preview?.plan ?? []).map((p) => [p.name, p]))
  const add = () => {
    set((c) => ({ ...c, scores: [...c.scores, { name: uniqueName(c.scores.map((s) => s.name), 'new_score'), sql: 'COUNT(*)', format: 'number' }] }))
    setOpen(cfg.scores.length)
  }

  return (
    <SectionFrame
      section="scores"
      title="Scores"
      editor={editor}
      description="SQL expressions per entity. A score can use other scores; they’re computed in dependency order."
      actions={<Button icon={<Plus />} onClick={add}>New score</Button>}
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <Card title="Base query">
            <div className="space-y-4">
              <Field label="FROM" hint="Tables and joins the aggregate scores read">
                <Code value={cfg.from} rows={3} onChange={(e) => set((c) => ({ ...c, from: e.target.value }))} />
              </Field>
              <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
                <Field label="WHERE" hint="Optional row filter">
                  <Code value={cfg.where ?? ''} rows={1} onChange={(e) => set((c) => clean({ ...c, where: e.target.value }))} />
                </Field>
                <Field label="Group by (key expression)">
                  <Input className="font-mono" value={cfg.key_expr} onChange={(e) => set((c) => ({ ...c, key_expr: e.target.value }))} />
                </Field>
              </div>
            </div>
          </Card>

          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {cfg.scores.map((s, i) => {
              const d = deps[s.name]
              return (
                <ItemCard
                  key={i}
                  title={<span className="flex items-center gap-2"><span className="font-mono">{s.name}</span>{s.label && <span className="font-normal text-muted">{s.label}</span>}</span>}
                  subtitle={<span className="font-mono">{s.sql}</span>}
                  badges={<>
                    {d && <Badge tone={d.layer === 0 ? 'neutral' : 'accent'}>layer {d.layer}</Badge>}
                    {s.window && <Badge tone="warning">window</Badge>}
                    <Badge>{s.format ?? 'number'}</Badge>
                  </>}
                  open={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
                  onUp={i > 0 ? () => set((c) => ({ ...c, scores: move(c.scores, i, -1) })) : undefined}
                  onDown={i < cfg.scores.length - 1 ? () => set((c) => ({ ...c, scores: move(c.scores, i, 1) })) : undefined}
                  onDuplicate={() => set((c) => ({ ...c, scores: [...c.scores, { ...s, name: uniqueName(c.scores.map((x) => x.name), s.name) }] }))}
                  onRemove={() => set((c) => ({ ...c, scores: remove(c.scores, i) }))}
                >
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Name" hint="Column in the score table"><Input className="font-mono" value={s.name} onChange={(e) => setScore(i, { ...s, name: e.target.value })} /></Field>
                      <Field label="Label"><Input value={s.label ?? ''} onChange={(e) => setScore(i, { ...s, label: e.target.value })} /></Field>
                      <Field label="Format">
                        <Select value={s.format ?? 'number'} onChange={(e) => setScore(i, { ...s, format: e.target.value as Score['format'] })}>
                          {FORMATS.map((f) => <option key={f}>{f}</option>)}
                        </Select>
                      </Field>
                    </div>
                    <Field label="SQL" hint={d?.depends_on.length ? `Uses ${d.depends_on.join(', ')}` : 'An aggregate over the base query'}>
                      <SqlEditor value={s.sql} minRows={2} onChange={(v) => setScore(i, { ...s, sql: v })} />
                    </Field>
                    <div className="grid gap-4 md:grid-cols-3">
                      <Field label="Description" className="md:col-span-2"><Input value={s.description ?? ''} onChange={(e) => setScore(i, { ...s, description: e.target.value })} /></Field>
                      <Field label="Default" hint="For entities with no rows">
                        <Input type="number" value={s.default ?? ''} onChange={(e) => setScore(i, { ...s, default: e.target.value === '' ? null : Number(e.target.value) })} />
                      </Field>
                    </div>
                    <Switch checked={!!s.window} onChange={(v) => setScore(i, { ...s, window: v || undefined })} label="Window function (ranks over all entities, e.g. NTILE)" />
                  </div>
                </ItemCard>
              )
            })}
          </div>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <PreviewPanel preview={preview} busy={busy} onRun={() => doPreview(editor.dirty ? cfg : undefined)} dirty={editor.dirty} scores={cfg.scores} />
        </div>
      </div>
    </SectionFrame>
  )
}

function PreviewPanel({ preview, busy, onRun, dirty, scores }:
  { preview: ScoresPreview | null; busy: boolean; onRun: () => void; dirty: boolean; scores: Score[] }) {
  const [tab, setTab] = useState<'graph' | 'sample' | 'stats' | 'sql'>('graph')
  const layers = Math.max(-1, ...(preview?.plan ?? []).map((p) => p.layer)) + 1
  const fmt = Object.fromEntries(scores.map((s) => [s.name, s.format]))

  return (
    <Card
      title="Preview"
      actions={<Button variant={dirty ? 'primary' : 'secondary'} size="sm" onClick={onRun} disabled={busy}>{busy ? 'Running…' : dirty ? 'Preview draft' : 'Refresh'}</Button>}
    >
      <p className="mb-3 text-[12px] text-muted">Runs the scoring query against the warehouse without writing anything.</p>
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'graph', label: 'Dependencies' }, { value: 'sample', label: 'Sample' }, { value: 'stats', label: 'Stats' }, { value: 'sql', label: 'SQL' },
      ]} />
      <div className="mt-4">
        {preview?.errors && <ErrorList errors={preview.errors} />}
        {preview?.error && <p className="mb-3 whitespace-pre-wrap rounded-lg bg-danger-subtle p-3 font-mono text-[12px] text-danger">{preview.error}</p>}
        {!preview ? <p className="text-[13px] text-muted">Loading…</p> : tab === 'graph' ? (
          <div className="space-y-3">
            {Array.from({ length: layers }).map((_, l) => (
              <div key={l}>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                  Layer {l} {l === 0 ? '· aggregates' : ''}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.plan.filter((p) => p.layer === l).map((p) => (
                    <span key={p.name} title={p.depends_on.length ? `uses ${p.depends_on.join(', ')}` : 'aggregate'}
                      className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${l === 0 ? 'border-line' : 'border-accent/30 bg-accent-subtle text-accent'}`}>
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
                {(preview.stats ?? []).map((s) => {
                  const name = String(s.column_name)
                  const num = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? String(v ?? '—') : formatValue(fmt[name], Number(v)))
                  const nulls = Number(s.null_percentage ?? 0)
                  return (
                    <tr key={name} className="border-t border-line/70">
                      <td className="px-2 py-1.5 font-mono">{name}</td>
                      <td className="num px-2 py-1.5 text-right">{fmt[name] === 'date' ? String(s.min ?? '').slice(0, 10) : num(s.min)}</td>
                      <td className="num px-2 py-1.5 text-right">{fmt[name] === 'date' ? '' : num(s.avg)}</td>
                      <td className="num px-2 py-1.5 text-right">{fmt[name] === 'date' ? String(s.max ?? '').slice(0, 10) : num(s.max)}</td>
                      <td className={`num px-2 py-1.5 text-right ${nulls > 0 ? 'text-warning' : 'text-muted'}`}>{nulls.toFixed(1)}%</td>
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
    </Card>
  )
}
