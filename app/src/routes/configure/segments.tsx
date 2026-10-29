import { Plus, Trash2 } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { ItemCard } from '~/components/config/ItemCard'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useConfig, useSection } from '~/components/config/state'
import { count } from '~/components/format'
import { Badge, Button, Field, Input, Select, useDebounced } from '~/components/ui'
import { clean, move, remove, replace, uniqueName } from '~/lib/edit'
import { OPS, type Rule, type Segment } from '~/lib/types'
import { previewSegment } from '~/server/config'

export const Route = createFileRoute('/configure/segments')({ component: SegmentsPage })

type Size = { size?: number; total?: number; where?: string; error?: string }

function useSize(rules: Rule[]): Size | null {
  const run = useServerFn(previewSegment)
  const debounced = useDebounced(JSON.stringify(rules), 400)
  const [size, setSize] = useState<Size | null>(null)
  useEffect(() => {
    let live = true
    run({ data: { rules: JSON.parse(debounced) } })
      .then((r) => live && setSize(r.errors ? { error: r.errors.join('; ') } : r))
      .catch((e) => live && setSize({ error: (e as Error).message }))
    return () => {
      live = false
    }
  }, [debounced, run])
  return size
}

function SizeBadge({ rules }: { rules: Rule[] }) {
  const s = useSize(rules)
  if (!s) return <Badge>…</Badge>
  if (s.error) return <Badge tone="danger">error</Badge>
  const pct = s.total ? Math.round(((s.size ?? 0) / s.total) * 100) : 0
  return <Badge tone="accent">{count(s.size)} · {pct}%</Badge>
}

function SegmentsPage() {
  const editor = useSection('segments')
  const { config } = useConfig()
  const [open, setOpen] = useState<number | null>(null)
  const segs = editor.value ?? []
  const columns = (config?.scores.scores ?? []).filter((s) => s.format !== 'text').map((s) => s.name)
  const labels = Object.fromEntries((config?.scores.scores ?? []).map((s) => [s.name, s.label ?? s.name]))

  const update = (i: number, s: Segment) => editor.set((xs) => replace(xs, i, clean(s)))
  const add = () => {
    editor.set((xs) => [...xs, { name: uniqueName(xs.map((x) => x.name), 'new_segment'), label: 'New segment', rules: [] }])
    setOpen(segs.length)
  }

  return (
    <SectionFrame
      section="segments"
      title="Segments"
      editor={editor}
      description="Saved groups over the score table. Every rule in a segment must hold."
      actions={<Button icon={<Plus />} onClick={add}>New segment</Button>}
    >
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {segs.map((s, i) => (
          <ItemCard
            key={i}
            title={s.label || s.name}
            subtitle={s.rules.length ? s.rules.map((r) => `${labels[r.column] ?? r.column} ${r.op} ${r.value}`).join('  and  ') : 'Everyone'}
            badges={<SizeBadge rules={s.rules} />}
            open={open === i}
            onToggle={() => setOpen(open === i ? null : i)}
            onUp={i > 0 ? () => editor.set((xs) => move(xs, i, -1)) : undefined}
            onDown={i < segs.length - 1 ? () => editor.set((xs) => move(xs, i, 1)) : undefined}
            onDuplicate={() => editor.set((xs) => [...xs, { ...s, name: uniqueName(xs.map((x) => x.name), s.name), label: `${s.label ?? s.name} (copy)` }])}
            onRemove={() => editor.set((xs) => remove(xs, i))}
          >
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Label"><Input value={s.label ?? ''} onChange={(e) => update(i, { ...s, label: e.target.value })} /></Field>
                <Field label="Name" hint="Stable id"><Input className="font-mono" value={s.name} onChange={(e) => update(i, { ...s, name: e.target.value })} /></Field>
                <Field label="Description"><Input value={s.description ?? ''} onChange={(e) => update(i, { ...s, description: e.target.value })} /></Field>
              </div>
              <div>
                <p className="mb-2 text-[12px] font-medium text-fg">Rules</p>
                <div className="space-y-2">
                  {s.rules.map((r, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <span className="w-10 text-right text-[12px] text-muted">{j === 0 ? 'where' : 'and'}</span>
                      <Select className="!w-56" value={r.column} onChange={(e) => update(i, { ...s, rules: replace(s.rules, j, { ...r, column: e.target.value }) })}>
                        {!columns.includes(r.column) && <option value={r.column}>{r.column} (unknown)</option>}
                        {columns.map((c) => <option key={c} value={c}>{labels[c]}</option>)}
                      </Select>
                      <Select className="!w-20 font-mono" value={r.op} onChange={(e) => update(i, { ...s, rules: replace(s.rules, j, { ...r, op: e.target.value as Rule['op'] }) })}>
                        {OPS.map((o) => <option key={o}>{o}</option>)}
                      </Select>
                      <Input type="number" step="any" className="!w-32" value={Number.isFinite(r.value) ? r.value : ''}
                        onChange={(e) => update(i, { ...s, rules: replace(s.rules, j, { ...r, value: e.target.value === '' ? NaN : Number(e.target.value) }) })} />
                      <Button variant="ghost" aria-label="Remove rule" icon={<Trash2 />} onClick={() => update(i, { ...s, rules: remove(s.rules, j) })} />
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="-ml-2" icon={<Plus />} disabled={!columns.length || s.rules.length >= 8}
                    onClick={() => update(i, { ...s, rules: [...s.rules, { column: columns[0], op: '>', value: 0 }] })}>
                    Add rule
                  </Button>
                </div>
              </div>
              <SizeDetail rules={s.rules} />
            </div>
          </ItemCard>
        ))}
      </div>
    </SectionFrame>
  )
}

function SizeDetail({ rules }: { rules: Rule[] }) {
  const s = useSize(rules)
  if (!s) return null
  if (s.error) {
    return <p className="rounded-lg bg-warning-subtle px-3 py-2 text-[12px] text-warning">{s.error.includes('unknown column') ? `${s.error}. Scores added since the last run exist after you run the pipeline.` : s.error}</p>
  }
  const pct = s.total ? ((s.size ?? 0) / s.total) * 100 : 0
  return (
    <div className="rounded-lg bg-subtle px-3 py-2.5">
      <div className="flex items-baseline justify-between text-[13px]">
        <span><span className="num font-semibold">{count(s.size)}</span> of {count(s.total)} in the current score table</span>
        <span className="font-mono text-[11px] text-muted">WHERE {s.where}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
