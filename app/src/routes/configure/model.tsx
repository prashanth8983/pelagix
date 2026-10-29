import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { DetailHeader, Group, MasterDetail, type ListItem } from '~/components/config/MasterDetail'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useConfig, useSection } from '~/components/config/state'
import { Button, Card, Field, Input, KeyValueEditor, Pre, Tabs } from '~/components/ui'
import type { ModelCfg, WarehouseTable } from '~/lib/types'
import { warehouseTables } from '~/server/config'

export const Route = createFileRoute('/configure/model')({
  validateSearch: z.object({ item: z.union([z.string(), z.number()]).transform(String).optional(), view: z.enum(['tables', 'joins', 'terms']).optional() }),
  component: ModelPage,
})

// Same text as agent_graph.describe_model, except the agent is given only the verified
// examples closest to the question asked (up to 8), not every one.
function promptText(m: ModelCfg, golden: { question: string; sql: string }[]) {
  const tables = Object.entries(m.tables)
    .map(([n, t]) => `  ${n} -- ${t.description ?? ''}\n` + Object.entries(t.columns).map(([c, d]) => `    ${c}: ${d}`).join('\n'))
    .join('\n')
  const joins = (m.joins ?? []).map((j) => `  ${j}`).join('\n')
  const terms = Object.entries(m.synonyms ?? {}).map(([k, v]) => `  "${k}" means ${v}`).join('\n')
  const ex = golden.map((g) => `Q: ${g.question}\nSQL:\n${g.sql.trim()}`).join('\n\n')
  return `TABLES\n${tables}\n\nJOINS\n${joins}\n\nBUSINESS TERMS\n${terms}\n\nVERIFIED EXAMPLES\n${ex}`
}

function ModelPage() {
  const editor = useSection('model')
  const { config } = useConfig()
  const { item, view = 'tables' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const fetchTables = useServerFn(warehouseTables)
  const [wh, setWh] = useState<WarehouseTable[]>([])
  const [showPrompt, setShowPrompt] = useState(false)
  const m = editor.value

  useEffect(() => {
    fetchTables().then(setWh).catch(() => {})
  }, [fetchTables])

  if (!m) return <SectionFrame section="model" title="Semantic model" editor={editor}><></></SectionFrame>

  const tables = m.tables ?? {}
  const names = Object.keys(tables)
  const selected = item && item in tables ? item : names[0] ?? null
  const select = (key: string) => navigate({ search: (s) => ({ ...s, item: key }), replace: true })
  const setView = (v: 'tables' | 'joins' | 'terms') => navigate({ search: (s) => ({ ...s, view: v }), replace: true })
  const byName = Object.fromEntries(wh.map((t) => [t.name, t]))
  const missing = wh.filter((t) => !(t.name in tables))
  const setTables = (t: ModelCfg['tables']) => editor.set((x) => ({ ...x, tables: t }))

  // Add a warehouse table, or fill in columns an existing entry doesn't describe yet.
  const importTable = (t: WarehouseTable) => {
    const cur = tables[t.name] ?? { description: '', columns: {} }
    const cols = { ...Object.fromEntries(t.columns.map((c) => [c.name, ''])), ...cur.columns }
    setTables({ ...tables, [t.name]: { ...cur, columns: cols } })
    select(t.name)
  }
  const rename = (from: string, to: string) => {
    if (!to || to === from || to in tables) return
    setTables(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k === from ? to : k, v])))
    select(to)
  }

  const items: ListItem[] = names.map((name) => {
    const t = tables[name]
    const w = byName[name]
    const undocumented = Object.values(t.columns).filter((d) => !d.trim()).length
    const newCols = w ? w.columns.filter((c) => !(c.name in t.columns)).length : 0
    return {
      key: name,
      title: <span className="font-mono">{name}</span>,
      subtitle: t.description || 'No description',
      badge: !w ? 'not in warehouse' : newCols ? `${newCols} new` : undocumented ? `${undocumented} undescribed` : `${Object.keys(t.columns).length} columns`,
      tone: !w ? 'danger' : newCols || undocumented ? 'warning' : 'neutral',
      text: `${name} ${t.description ?? ''} ${Object.keys(t.columns).join(' ')}`,
    }
  })
  const t = selected ? tables[selected] : undefined
  const w = selected ? byName[selected] : undefined
  const newCols = t && w ? w.columns.filter((c) => !(c.name in t.columns)).length : 0

  return (
    <SectionFrame
      section="model"
      title="Semantic model"
      editor={editor}
      actions={<>
        <Button icon={<Sparkles />} onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? 'Hide' : 'Show'} agent prompt</Button>
        <Tabs value={view} onChange={setView} options={[
          { value: 'tables', label: `Tables (${names.length})` }, { value: 'joins', label: `Joins (${m.joins?.length ?? 0})` },
          { value: 'terms', label: `Business terms (${Object.keys(m.synonyms ?? {}).length})` },
        ]} />
      </>}
    >
      {showPrompt && (
        <Card title={<span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-accent" />What the agent sees</span>} description="Exactly what the agent receives" className="mb-5">
          <Pre className="max-h-96">{promptText(m, config?.golden ?? [])}</Pre>
        </Card>
      )}

      {view === 'tables' && (
        <MasterDetail
          items={items}
          selected={selected}
          onSelect={select}
          searchPlaceholder="Search tables"
          emptyTitle="No tables in the model"
          emptyHint="Add a warehouse table below to let the agent and the SQL workspace read it."
          below={missing.length > 0 ? (
            <div className="p-2">
              <p className="px-1 pb-1 text-[11px] font-medium text-faint">Not in the model</p>
              {missing.map((x) => (
                <div key={x.name} className="flex items-center justify-between gap-2 rounded-md px-1 py-1">
                  <span className="truncate font-mono text-[12px]">{x.name} <span className="text-[11px] text-faint">{x.columns.length} cols</span></span>
                  <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => importTable(x)}>Add</Button>
                </div>
              ))}
            </div>
          ) : undefined}
        >
          {t && selected && (
            <>
              <DetailHeader
                title={<span className="font-mono">{selected}</span>}
                subtitle={w ? `${w.rows.toLocaleString()} rows in the warehouse` : 'Not in the warehouse'}
                onRemove={() => {
                  setTables(Object.fromEntries(Object.entries(tables).filter(([k]) => k !== selected)))
                  select(names.find((n) => n !== selected) ?? '')
                }}
              />
              <Group title="Table" help="The name must match the warehouse table. The description tells the agent what a row is.">
                <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
                  <Field label="Name">
                    <Input className="font-mono" key={selected} defaultValue={selected} onBlur={(e) => rename(selected, e.target.value.trim())} />
                  </Field>
                  <Field label="Description" hint="What one row is">
                    <Input value={t.description ?? ''} onChange={(e) => setTables({ ...tables, [selected]: { ...t, description: e.target.value } })} />
                  </Field>
                </div>
              </Group>
              <Group title="Columns" help="Units, allowed values and meaning. Undescribed columns are still queryable but the agent has to guess.">
                <KeyValueEditor keyLabel="Column" valueLabel="Meaning (units, allowed values)" value={t.columns} addLabel="Add column"
                  onChange={(cols) => setTables({ ...tables, [selected]: { ...t, columns: cols } })} />
                {newCols > 0 && w && <Button size="sm" className="mt-3" onClick={() => importTable(w)}>Add the {newCols} warehouse columns not listed</Button>}
              </Group>
            </>
          )}
        </MasterDetail>
      )}

      {view === 'joins' && (
        <Group title="Joins" help="How tables relate, one equality per line, for example orders.user_id = users.id. The agent uses these verbatim.">
          <div className="space-y-1.5">
            {(m.joins ?? []).map((j, i) => (
              <div key={i} className="flex gap-1.5">
                <Input className="font-mono text-[12px]" value={j} placeholder="left.column = right.column"
                  onChange={(e) => editor.set((x) => ({ ...x, joins: (x.joins ?? []).map((y, k) => (k === i ? e.target.value : y)) }))} />
                <Button variant="ghost" aria-label="Remove join" icon={<Trash2 />} onClick={() => editor.set((x) => ({ ...x, joins: (x.joins ?? []).filter((_, k) => k !== i) }))} />
              </div>
            ))}
            <Button variant="ghost" size="sm" className="-ml-2" icon={<Plus />} onClick={() => editor.set((x) => ({ ...x, joins: [...(x.joins ?? []), ''] }))}>Add join</Button>
          </div>
        </Group>
      )}

      {view === 'terms' && (
        <Group title="Business terms" help="What a word means in SQL, for example VIP means ltv_decile >= 9. The agent applies these exactly.">
          <KeyValueEditor keyLabel="Term" valueLabel="Means" mono value={m.synonyms ?? {}} addLabel="Add term"
            onChange={(v) => editor.set((x) => ({ ...x, synonyms: v }))} />
        </Group>
      )}
    </SectionFrame>
  )
}
