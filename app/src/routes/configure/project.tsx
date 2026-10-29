import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Group } from '~/components/config/MasterDetail'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useConfig, useSection } from '~/components/config/state'
import { Badge, Field, Input, Select, Switch, TagInput, cx } from '~/components/ui'
import { clean, errorsAt } from '~/lib/edit'
import type { ProjectCfg, WarehouseKind, WarehouseTable } from '~/lib/types'
import { warehouseTables } from '~/server/config'

const PARTS = ['entity', 'warehouse', 'publish', 'display'] as const
type Part = (typeof PARTS)[number]

export const Route = createFileRoute('/configure/project')({
  validateSearch: z.object({ part: z.enum(PARTS).optional() }),
  component: ProjectPage,
})

const WAREHOUSES: { value: WarehouseKind; label: string; note: string }[] = [
  { value: 'duckdb', label: 'DuckDB (local file)', note: 'Local file, no server.' },
  { value: 'postgres', label: 'Postgres', note: 'A schema in any Postgres database.' },
  { value: 'snowflake', label: 'Snowflake (untested)', note: 'Written but not yet run against an account.' },
]

const PART_INFO: Record<Part, { title: string; summary: string; errorPaths: string[] }> = {
  entity: { title: 'Entity', summary: 'What each score row describes', errorPaths: ['key', 'entity', 'entity_table', 'entity_key', 'attributes', 'project.key', 'project.entity_table', 'project.attributes'] },
  warehouse: { title: 'Warehouse', summary: 'Where raw tables land and scores are computed', errorPaths: ['warehouse'] },
  publish: { title: 'Publish', summary: 'Where the app reads scores from', errorPaths: ['publish'] },
  display: { title: 'Display', summary: 'How the app lists entities', errorPaths: ['display', 'project.display'] },
}

function ProjectPage() {
  const editor = useSection('project')
  const { config } = useConfig()
  const { part = 'entity' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const fetchTables = useServerFn(warehouseTables)
  const [tables, setTables] = useState<WarehouseTable[]>([])
  const p = editor.value
  const errs = editor.errors
  const set = (patch: (p: ProjectCfg) => ProjectCfg) => editor.set((prev) => clean(patch(prev)))
  const scoreNames = config?.scores.scores.map((s) => s.name) ?? []
  const sources = config?.sources.map((s) => s.name) ?? []
  const wh = p?.warehouse ?? {}
  const kind = wh.kind ?? 'duckdb'
  const display = p?.display ?? {}
  const entityColumns = tables.find((t) => t.name === p?.entity_table)?.columns.map((c) => c.name) ?? []
  const problems = (x: Part) => PART_INFO[x].errorPaths.some((path) => errorsAt(errs, path))

  useEffect(() => {
    fetchTables().then(setTables).catch(() => {})
  }, [fetchTables])

  return (
    <SectionFrame section="project" title="Project" editor={editor}>
      {p && (
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Project sections" className="self-start overflow-hidden rounded-lg border border-line bg-surface shadow-card py-1 lg:sticky lg:top-20">
            {PARTS.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => navigate({ search: { part: x }, replace: true })}
                aria-current={part === x ? 'page' : undefined}
                className={cx('flex w-full items-center gap-2 px-3 py-2 text-left transition-colors', part === x ? 'bg-accent-subtle' : 'hover:bg-hover')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{PART_INFO[x].title}</span>
                  <span className="block truncate text-[11.5px] text-muted">{PART_INFO[x].summary}</span>
                </span>
                {problems(x) && <Badge tone="danger">fix</Badge>}
              </button>
            ))}
          </nav>

          <div key={part} className="anim-fade space-y-5">
            {part === 'entity' && (
              <>
                <Group title="Entity" help="The thing each score row describes, and the column that identifies it.">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Project name"><Input value={p.name ?? ''} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} /></Field>
                    <Field label="Entity" hint="Singular: customer, account, device">
                      <Input value={p.entity ?? ''} onChange={(e) => set((x) => ({ ...x, entity: e.target.value }))} />
                    </Field>
                    <Field label="Key column" hint="The key's column name in the score table" error={errorsAt(errs, 'key') ?? errorsAt(errs, 'project.key')}>
                      <Input className="font-mono" value={p.key} onChange={(e) => set((x) => ({ ...x, key: e.target.value }))} />
                    </Field>
                  </div>
                </Group>
                <Group title="Entity table" help="A source that lists every entity. With one, entities with no activity still get a row (with each score's default). Without one, only entities that appear in the base query are scored.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Table" error={errorsAt(errs, 'project.entity_table')}>
                      <Select value={p.entity_table ?? ''} onChange={(e) => set((x) => ({ ...x, entity_table: e.target.value, attributes: e.target.value ? x.attributes : [] }))}>
                        <option value="">None (only entities with activity)</option>
                        {sources.map((s) => <option key={s}>{s}</option>)}
                      </Select>
                    </Field>
                    <Field label="Key column in that table" error={errorsAt(errs, 'entity_key')}>
                      <Input className="font-mono" value={p.entity_key ?? ''} disabled={!p.entity_table} placeholder="id"
                        onChange={(e) => set((x) => ({ ...x, entity_key: e.target.value }))} />
                    </Field>
                    <Field label="Attributes" className="col-span-full" error={errorsAt(errs, 'attributes') ?? errorsAt(errs, 'project.attributes')}
                      hint={p.entity_table
                        ? 'Entity columns copied as-is, for filters and display.'
                        : 'Choose an entity table first'}>
                      <TagInput value={p.attributes ?? []} suggestions={entityColumns} placeholder={p.entity_table ? 'Type a column name' : ''}
                        onChange={(v) => set((x) => ({ ...x, attributes: v }))} />
                    </Field>
                  </div>
                </Group>
              </>
            )}

            {part === 'warehouse' && (
              <Group title="Warehouse" help="Raw tables land here and the scoring query runs here. Change it before the first run; switching later means reloading every source.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Kind" className="col-span-full" hint={WAREHOUSES.find((w) => w.value === kind)?.note}>
                    <Select value={kind} onChange={(e) => set((x) => ({ ...x, warehouse: { kind: e.target.value as WarehouseKind } }))}>
                      {WAREHOUSES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </Select>
                  </Field>
                  {kind === 'duckdb' && (
                    <Field label="Database file" hint="Relative to the engine home (SCOREBASE_HOME)">
                      <Input className="font-mono" value={wh.path ?? ''} placeholder={`data/${p.name ?? 'project'}.duckdb`}
                        onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, path: e.target.value } }))} />
                    </Field>
                  )}
                  {kind === 'postgres' && (
                    <>
                      <Field label="URL variable" hint="Env var with the Postgres URL">
                        <Input className="font-mono" value={wh.url_env ?? ''} placeholder="SCOREBASE_WAREHOUSE_URL"
                          onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, url_env: e.target.value } }))} />
                      </Field>
                      <Field label="Schema" hint="Created if missing" error={errorsAt(errs, 'warehouse.schema')}>
                        <Input className="font-mono" value={wh.schema ?? ''} placeholder="warehouse"
                          onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, schema: e.target.value } }))} />
                      </Field>
                    </>
                  )}
                  {kind === 'snowflake' && (
                    <>
                      <Field label="Database"><Input value={wh.database ?? ''} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, database: e.target.value } }))} /></Field>
                      <Field label="Schema"><Input value={wh.schema ?? ''} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, schema: e.target.value } }))} /></Field>
                      <Field label="Compute warehouse"><Input value={wh.compute ?? ''} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, compute: e.target.value } }))} /></Field>
                      <p className="col-span-full text-[12px] text-muted">Credentials come from SNOWFLAKE_* environment variables. Use a read-only role.</p>
                    </>
                  )}
                </div>
              </Group>
            )}

            {part === 'publish' && (
              <Group title="Publish" help="After scoring, the score table is copied to the app's Postgres database, writing only rows that changed.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Postgres URL variable" hint="Never stored in config">
                    <Input className="font-mono" value={p.publish?.postgres_url_env ?? ''} placeholder="SCOREBASE_PG_URL"
                      onChange={(e) => set((x) => ({ ...x, publish: { ...x.publish, postgres_url_env: e.target.value } }))} />
                  </Field>
                  <Field label="Score table" hint="Name in both the warehouse and Postgres" error={errorsAt(errs, 'publish.table')}>
                    <Input className="font-mono" value={p.publish?.table ?? ''} placeholder="entity_scores"
                      onChange={(e) => set((x) => ({ ...x, publish: { ...x.publish, table: e.target.value } }))} />
                  </Field>
                  <div className="col-span-full">
                    <Switch checked={!!p.publish?.history} onChange={(v) => set((x) => ({ ...x, publish: { ...x.publish, history: v || undefined } }))}
                      label={<span>Keep score history <span className="text-muted">(one row per {p.entity || 'entity'} per run, in {p.publish?.table || 'entity_scores'}_history)</span></span>} />
                  </div>
                </div>
              </Group>
            )}

            {part === 'display' && (
              <Group title="Display" help="What the overview shows for each entity. Everything here must be a score, or an attribute for the table columns.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Entity label (plural)"><Input value={display.entity_label ?? ''} placeholder="Customers"
                    onChange={(e) => set((x) => ({ ...x, display: { ...x.display, entity_label: e.target.value } }))} /></Field>
                  <Field label="Bar column" hint="A 0 to 1 score drawn as a bar" error={errorsAt(errs, 'project.display.highlight')}>
                    <Select value={display.highlight ?? ''} onChange={(e) => set((x) => ({ ...x, display: { ...x.display, highlight: e.target.value } }))}>
                      <option value="">None</option>
                      {scoreNames.map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  </Field>
                  <Field label="Table columns" hint="In display order" className="col-span-full"
                    error={errorsAt(errs, 'project.display.columns')}>
                    <TagInput value={display.columns ?? []} suggestions={[...scoreNames, ...(p.attributes ?? [])]}
                      onChange={(v) => set((x) => ({ ...x, display: { ...x.display, columns: v } }))} placeholder="Type a score or attribute name" />
                  </Field>
                  <Field label="Default sort" error={errorsAt(errs, 'project.display.default_sort')}>
                    <Select value={display.default_sort ?? ''} onChange={(e) => set((x) => ({ ...x, display: { ...x.display, default_sort: e.target.value } }))}>
                      <option value="">First numeric score</option>
                      {scoreNames.map((s) => <option key={s}>{s}</option>)}
                    </Select>
                  </Field>
                  <Field label="Direction">
                    <Select value={display.sort_dir ?? 'desc'} onChange={(e) => set((x) => ({ ...x, display: { ...x.display, sort_dir: e.target.value as 'asc' } }))}>
                      <option value="desc">Highest first</option>
                      <option value="asc">Lowest first</option>
                    </Select>
                  </Field>
                </div>
              </Group>
            )}
          </div>
        </div>
      )}
    </SectionFrame>
  )
}
