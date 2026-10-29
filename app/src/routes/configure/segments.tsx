import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { DetailHeader, Group, MasterDetail, type ListItem } from '~/components/config/MasterDetail'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useConfig, useSection } from '~/components/config/state'
import { count } from '~/components/ui/format'
import { Button, Field, Input, Select, TagInput, Tabs, useDebounced } from '~/components/ui'
import { clean, errorsAt, move, remove, replace, uniqueName } from '~/lib/edit'
import { OP_LABELS, OPS_FOR, type Op, type Rule, type Scalar, type Segment } from '~/lib/types'
import { previewSegment } from '~/server/config'

export const Route = createFileRoute('/configure/segments')({
  validateSearch: z.object({ item: z.union([z.string(), z.number()]).transform(String).optional() }),
  component: SegmentsPage,
})

type Kind = 'number' | 'string'
type Column = { name: string; label: string; kind: Kind }
type Size = { size?: number; total?: number; where?: string; error?: string }

function useSize(rules: Rule[], match: 'all' | 'any'): Size | null {
  const run = useServerFn(previewSegment)
  const debounced = useDebounced(JSON.stringify({ rules, match }), 400)
  const [size, setSize] = useState<Size | null>(null)
  useEffect(() => {
    let live = true
    run({ data: JSON.parse(debounced) })
      .then((r) => live && setSize(r.errors ? { error: r.errors.join('; ') } : r))
      .catch((e) => live && setSize({ error: (e as Error).message }))
    return () => {
      live = false
    }
  }, [debounced, run])
  return size
}

/** A rule in words, for list rows. */
function describe(r: Rule, columns: Record<string, Column>): string {
  const label = columns[r.column]?.label ?? r.column
  const op = OP_LABELS[r.op] ?? r.op
  if (r.op === 'is_null' || r.op === 'is_not_null') return `${label} ${op}`
  const v = Array.isArray(r.value) ? r.value.join(', ') : String(r.value ?? '')
  return `${label} ${op} ${v}`
}

function SegmentsPage() {
  const editor = useSection('segments')
  const { config } = useConfig()
  const { item } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const segs = editor.value ?? []
  const errs = editor.errors
  const i = Math.min(Number(item ?? 0) || 0, Math.max(segs.length - 1, 0))
  const selected = segs.length ? String(i) : null
  const select = (key: string) => navigate({ search: { item: key }, replace: true })

  // Rules may use numeric scores and the entity attributes from project.yaml.
  const columns = useMemo<Column[]>(() => [
    ...(config?.project.attributes ?? []).map((a) => ({ name: a, label: a.replace(/_/g, ' '), kind: 'string' as Kind })),
    ...(config?.scores.scores ?? []).filter((s) => s.format !== 'text').map((s) => ({ name: s.name, label: s.label ?? s.name, kind: 'number' as Kind })),
  ], [config])
  const byName = useMemo(() => Object.fromEntries(columns.map((c) => [c.name, c])), [columns])

  const update = (s: Segment) => editor.set((xs) => replace(xs, i, clean(s)))
  const add = () => {
    editor.set((xs) => [...xs, { name: uniqueName(xs.map((x) => x.name), 'new_segment'), label: 'New segment', rules: [] }])
    select(String(segs.length))
  }

  const items: ListItem[] = segs.map((s, j) => {
    const match = s.match ?? 'all'
    const bad = errorsAt(errs, `${j}`)
    return {
      key: String(j),
      title: s.label || s.name,
      subtitle: s.rules.length ? s.rules.map((r) => describe(r, byName)).join(s.match === 'any' ? ' or ' : ' and ') : 'Everyone',
      badge: bad ? 'invalid' : s.rules.length > 1 && match === 'any' ? 'any' : undefined,
      tone: bad ? 'danger' : 'neutral',
      text: `${s.label ?? ''} ${s.name} ${s.description ?? ''}`,
    }
  })
  const s = segs[i]
  const match = s?.match ?? 'all'

  return (
    <SectionFrame section="segments" title="Segments" editor={editor} actions={<Button icon={<Plus />} onClick={add}>New segment</Button>}>
      <MasterDetail
        items={items}
        selected={selected}
        onSelect={select}
        onNew={add}
        newLabel="New segment"
        searchPlaceholder="Search segments"
        emptyTitle="No segments yet"
        emptyHint="A segment is a group of entities picked by rules on their scores and attributes."
      >
        {s && (
          <>
            <DetailHeader
              title={s.label || s.name}
              subtitle={<span className="font-mono">{s.name}</span>}
              onUp={i > 0 ? () => editor.set((xs) => move(xs, i, -1)) : undefined}
              onDown={i < segs.length - 1 ? () => editor.set((xs) => move(xs, i, 1)) : undefined}
              onDuplicate={() => {
                editor.set((xs) => [...xs, { ...s, name: uniqueName(xs.map((x) => x.name), s.name), label: `${s.label ?? s.name} (copy)` }])
                select(String(segs.length))
              }}
              onRemove={() => {
                editor.set((xs) => remove(xs, i))
                select(String(Math.max(0, i - 1)))
              }}
            />

            <Group title="Identity" help="How the segment is shown, and its stable id.">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Label" error={errorsAt(errs, `${i}.label`)}>
                  <Input value={s.label ?? ''} onChange={(e) => update({ ...s, label: e.target.value })} />
                </Field>
                <Field label="Name" hint="Used in URLs and the segments table" error={errorsAt(errs, `${i}.name`)}>
                  <Input className="font-mono" value={s.name} onChange={(e) => update({ ...s, name: e.target.value })} />
                </Field>
                <Field label="Description" hint="Shown under the segment on the overview">
                  <Input value={s.description ?? ''} onChange={(e) => update({ ...s, description: e.target.value })} />
                </Field>
              </div>
            </Group>

            <Group title="Rules" help="An entity belongs to the segment when the rules hold. With no rules, every entity does.">
              {s.rules.length > 1 && (
                <div className="mb-3">
                  <Tabs value={match} onChange={(m) => update({ ...s, match: m === 'all' ? undefined : m })}
                    options={[{ value: 'all', label: 'All rules must hold' }, { value: 'any', label: 'Any rule may hold' }]} />
                </div>
              )}
              <div className="space-y-2">
                {s.rules.map((r, j) => (
                  <RuleRow
                    key={j}
                    rule={r}
                    first={j === 0}
                    joiner={match === 'any' ? 'or' : 'and'}
                    columns={columns}
                    error={errorsAt(errs, `${i}.rules.${j}`)}
                    onChange={(next) => update({ ...s, rules: replace(s.rules, j, next) })}
                    onRemove={() => update({ ...s, rules: remove(s.rules, j) })}
                  />
                ))}
                <Button variant="ghost" size="sm" className="-ml-2" icon={<Plus />} disabled={!columns.length || s.rules.length >= 8}
                  onClick={() => update({ ...s, rules: [...s.rules, defaultRule(columns[0])] })}>
                  Add rule
                </Button>
              </div>
              <div className="mt-4">
                <SizeDetail rules={s.rules} match={match} />
              </div>
            </Group>
          </>
        )}
      </MasterDetail>
    </SectionFrame>
  )
}

const defaultRule = (c: Column): Rule => (c.kind === 'string' ? { column: c.name, op: '=', value: '' } : { column: c.name, op: '>', value: 0 })

/** Move a rule to another column or operator, keeping the value when it still fits. */
function retarget(r: Rule, column: Column, op: Op): Rule {
  if (op === 'is_null' || op === 'is_not_null') return { column: column.name, op }
  const list = op === 'in' || op === 'not_in'
  const toScalar = (v: unknown): Scalar => (column.kind === 'number' ? (typeof v === 'number' ? v : Number(v) || 0) : String(v ?? ''))
  if (list) {
    const vals = Array.isArray(r.value) ? r.value : r.value == null || r.value === '' ? [] : [r.value]
    return { column: column.name, op, value: vals.map(toScalar) }
  }
  const v = Array.isArray(r.value) ? r.value[0] : r.value
  return { column: column.name, op, value: v == null ? (column.kind === 'number' ? 0 : '') : toScalar(v) }
}

function RuleRow({ rule: r, first, joiner, columns, error, onChange, onRemove }: {
  rule: Rule
  first: boolean
  joiner: 'and' | 'or'
  columns: Column[]
  error?: string
  onChange: (r: Rule) => void
  onRemove: () => void
}) {
  const column = columns.find((c) => c.name === r.column)
  const kind: Kind = column?.kind ?? 'number'
  const ops = OPS_FOR[kind]
  const list = r.op === 'in' || r.op === 'not_in'
  const noValue = r.op === 'is_null' || r.op === 'is_not_null'
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-10 text-right text-[12px] text-muted">{first ? 'where' : joiner}</span>
        <Select className="!w-52" value={r.column} aria-label="Column"
          onChange={(e) => {
            const c = columns.find((x) => x.name === e.target.value)!
            onChange(retarget(r, c, OPS_FOR[c.kind].includes(r.op) ? r.op : OPS_FOR[c.kind][0]))
          }}>
          {!column && <option value={r.column}>{r.column} (unknown)</option>}
          {columns.some((c) => c.kind === 'string') && (
            <optgroup label="Attributes">{columns.filter((c) => c.kind === 'string').map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}</optgroup>
          )}
          <optgroup label="Scores">{columns.filter((c) => c.kind === 'number').map((c) => <option key={c.name} value={c.name}>{c.label}</option>)}</optgroup>
        </Select>
        <Select className="!w-36" value={r.op} aria-label="Operator"
          onChange={(e) => onChange(retarget(r, column ?? { name: r.column, label: r.column, kind }, e.target.value as Op))}>
          {ops.map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
        </Select>
        {!noValue && (list ? (
          <div className="min-w-64 flex-1">
            <TagInput
              value={(Array.isArray(r.value) ? r.value : []).map(String)}
              placeholder={kind === 'number' ? 'Numbers, Enter between each' : 'Values, Enter between each'}
              onChange={(vals) => onChange({ ...r, value: kind === 'number' ? vals.map(Number).filter((n) => !Number.isNaN(n)) : vals })}
            />
          </div>
        ) : kind === 'number' ? (
          <Input type="number" step="any" className="!w-32" aria-label="Value" value={typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : ''}
            onChange={(e) => onChange({ ...r, value: e.target.value === '' ? NaN : Number(e.target.value) })} />
        ) : (
          <Input className="!w-48" aria-label="Value" value={typeof r.value === 'string' ? r.value : ''} placeholder="Exact text"
            onChange={(e) => onChange({ ...r, value: e.target.value })} />
        ))}
        <Button variant="ghost" aria-label="Remove rule" icon={<Trash2 />} onClick={onRemove} />
      </div>
      {error && <p className="ml-12 mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  )
}

function SizeDetail({ rules, match }: { rules: Rule[]; match: 'all' | 'any' }) {
  const s = useSize(rules, match)
  if (!s) return null
  if (s.error) {
    return <p className="rounded-lg bg-warning-subtle px-3 py-2 text-[12px] text-warning">{s.error.includes('unknown column') ? `${s.error}. Scores and attributes added since the last run exist after you run the pipeline.` : s.error}</p>
  }
  const pct = s.total ? ((s.size ?? 0) / s.total) * 100 : 0
  return (
    <div className="rounded-lg bg-subtle px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
        <span><span className="num font-semibold">{count(s.size)}</span> of {count(s.total)} in the current score table</span>
        <span className="font-mono text-[11px] text-muted">WHERE {s.where}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
