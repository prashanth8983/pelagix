import { Plus, Trash2 } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { ItemCard } from '~/components/config/ItemCard'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useConfig, useSection } from '~/components/config/state'
import { Badge, Button, Card, Input, KeyValueEditor, Pre } from '~/components/ui'
import type { ModelCfg, WarehouseTable } from '~/lib/types'
import { warehouseTables } from '~/server/config'

export const Route = createFileRoute('/configure/model')({ component: ModelPage })

// Same text as describeModel in server/scorebase.ts and agent_graph.describe_model.
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
  const fetchTables = useServerFn(warehouseTables)
  const [wh, setWh] = useState<WarehouseTable[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const m = editor.value

  useEffect(() => {
    fetchTables().then(setWh).catch(() => {})
  }, [fetchTables])

  if (!m) return <SectionFrame section="model" title="Semantic model" editor={editor} description=""><></></SectionFrame>

  const tables = m.tables ?? {}
  const byName = Object.fromEntries(wh.map((t) => [t.name, t]))
  const missing = wh.filter((t) => !(t.name in tables))
  const setTables = (t: ModelCfg['tables']) => editor.set((x) => ({ ...x, tables: t }))

  // Add a warehouse table, or fill in columns an existing entry doesn't describe yet.
  const importTable = (t: WarehouseTable) => {
    const cur = tables[t.name] ?? { description: '', columns: {} }
    const cols = { ...Object.fromEntries(t.columns.map((c) => [c.name, ''])), ...cur.columns }
    setTables({ ...tables, [t.name]: { ...cur, columns: cols } })
    setOpen(t.name)
  }
  const rename = (from: string, to: string) =>
    setTables(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k === from ? to : k, v])))

  return (
    <SectionFrame
      section="model"
      title="Semantic model"
      editor={editor}
      description="Tables the agent and SQL workspace may read, and what their columns mean."
      actions={<Button onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? 'Hide' : 'Show'} agent prompt</Button>}
    >
      {showPrompt && (
        <Card title="What the agent sees" className="mb-5">
          <Pre className="max-h-96">{promptText(m, config?.golden ?? [])}</Pre>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="self-start divide-y divide-line overflow-hidden rounded-lg border border-line">
          {Object.entries(tables).map(([name, t]) => {
            const w = byName[name]
            const undocumented = Object.values(t.columns).filter((d) => !d.trim()).length
            const newCols = w ? w.columns.filter((c) => !(c.name in t.columns)).length : 0
            return (
              <ItemCard
                key={name}
                title={<span className="font-mono">{name}</span>}
                subtitle={t.description || 'No description'}
                badges={<>
                  {!w && <Badge tone="danger">not in warehouse</Badge>}
                  {newCols > 0 && <Badge tone="warning">{newCols} new columns</Badge>}
                  {undocumented > 0 && <Badge tone="warning">{undocumented} undescribed</Badge>}
                  <Badge>{Object.keys(t.columns).length} columns</Badge>
                </>}
                open={open === name}
                onToggle={() => setOpen(open === name ? null : name)}
                onRemove={() => setTables(Object.fromEntries(Object.entries(tables).filter(([k]) => k !== name)))}
              >
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-fg">Table</span>
                      <Input className="font-mono" defaultValue={name} onBlur={(e) => e.target.value !== name && rename(name, e.target.value)} />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-fg">Description</span>
                      <Input value={t.description ?? ''} onChange={(e) => setTables({ ...tables, [name]: { ...t, description: e.target.value } })} />
                    </label>
                  </div>
                  <KeyValueEditor keyLabel="Column" valueLabel="Meaning (units, allowed values)" value={t.columns}
                    onChange={(cols) => setTables({ ...tables, [name]: { ...t, columns: cols } })} />
                  {newCols > 0 && w && <Button size="sm" onClick={() => importTable(w)}>Add the {newCols} warehouse columns not listed</Button>}
                </div>
              </ItemCard>
            )
          })}
        </div>

        <div className="space-y-5">
          {missing.length > 0 && (
            <Card title="Warehouse tables not in the model">
              <p className="mb-3 text-[12px] text-muted">Hidden from the agent and the SQL workspace until added.</p>
              <div className="space-y-1.5">
                {missing.map((t) => (
                  <div key={t.name} className="flex items-center justify-between">
                    <span className="font-mono text-[13px]">{t.name} <span className="text-[11px] text-muted">{t.columns.length} cols</span></span>
                    <Button size="sm" onClick={() => importTable(t)}>Add</Button>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card title="Joins">
            <p className="mb-3 text-[12px] text-muted">How tables relate, e.g. <span className="font-mono">orders.user_id = users.id</span></p>
            <div className="space-y-1.5">
              {(m.joins ?? []).map((j, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input className="font-mono text-[12px]" value={j}
                    onChange={(e) => editor.set((x) => ({ ...x, joins: (x.joins ?? []).map((y, k) => (k === i ? e.target.value : y)) }))} />
                  <Button variant="ghost" aria-label="Remove join" icon={<Trash2 />} onClick={() => editor.set((x) => ({ ...x, joins: (x.joins ?? []).filter((_, k) => k !== i) }))} />
                </div>
              ))}
              <Button variant="ghost" size="sm" className="-ml-2" icon={<Plus />} onClick={() => editor.set((x) => ({ ...x, joins: [...(x.joins ?? []), ''] }))}>Add join</Button>
            </div>
          </Card>
          <Card title="Business terms">
            <p className="mb-3 text-[12px] text-muted">What words mean in SQL. The agent uses these exactly.</p>
            <KeyValueEditor keyLabel="Term" valueLabel="Means" mono value={m.synonyms ?? {}}
              onChange={(v) => editor.set((x) => ({ ...x, synonyms: v }))} />
          </Card>
        </div>
      </div>
    </SectionFrame>
  )
}
