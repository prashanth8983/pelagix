import { createFileRoute } from '@tanstack/react-router'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useConfig, useSection } from '~/components/config/state'
import { Card, Field, Input, Select, TagInput } from '~/components/ui'
import { clean } from '~/lib/edit'
import type { ProjectCfg } from '~/lib/types'

export const Route = createFileRoute('/configure/project')({ component: ProjectPage })

function ProjectPage() {
  const editor = useSection('project')
  const { config } = useConfig()
  const p = editor.value
  const set = (patch: (p: ProjectCfg) => ProjectCfg) => editor.set((prev) => clean(patch(prev)))
  const scoreNames = config?.scores.scores.map((s) => s.name) ?? []
  const sources = config?.sources.map((s) => s.name) ?? []
  const wh = p?.warehouse ?? {}
  const display = p?.display ?? {}

  return (
    <SectionFrame
      section="project"
      title="Project"
      editor={editor}
      description="The entity being scored, the warehouse, where scores are published, and how the app lists them."
    >
      {p && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Entity">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Project name"><Input value={p.name ?? ''} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} /></Field>
              <Field label="Entity" hint="Singular: customer, account, device…">
                <Input value={p.entity ?? ''} onChange={(e) => set((x) => ({ ...x, entity: e.target.value }))} />
              </Field>
              <Field label="Key column" hint="Names the key in the score table">
                <Input className="font-mono" value={p.key} onChange={(e) => set((x) => ({ ...x, key: e.target.value }))} />
              </Field>
              <div />
              <Field label="Entity table" hint="Every row here gets scores, even with no activity">
                <Select value={p.entity_table ?? ''} onChange={(e) => set((x) => ({ ...x, entity_table: e.target.value }))}>
                  <option value="">None (only entities with activity)</option>
                  {sources.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="Entity table key">
                <Input className="font-mono" value={p.entity_key ?? ''} disabled={!p.entity_table}
                  onChange={(e) => set((x) => ({ ...x, entity_key: e.target.value }))} />
              </Field>
            </div>
          </Card>

          <Card title="Warehouse">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind">
                <Select value={wh.kind ?? 'duckdb'} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, kind: e.target.value as 'duckdb' } }))}>
                  <option value="duckdb">DuckDB (local file)</option>
                  <option value="snowflake">Snowflake</option>
                </Select>
              </Field>
              {(wh.kind ?? 'duckdb') === 'duckdb' ? (
                <Field label="Database file" hint="Relative to the repo root">
                  <Input className="font-mono" value={wh.path ?? ''} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, path: e.target.value } }))} />
                </Field>
              ) : (
                <>
                  <Field label="Database"><Input value={wh.database ?? ''} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, database: e.target.value } }))} /></Field>
                  <Field label="Schema"><Input value={wh.schema ?? ''} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, schema: e.target.value } }))} /></Field>
                  <Field label="Compute warehouse"><Input value={wh.compute ?? ''} onChange={(e) => set((x) => ({ ...x, warehouse: { ...x.warehouse, compute: e.target.value } }))} /></Field>
                  <p className="col-span-full text-[12px] text-muted">Credentials come from SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PASSWORD and SNOWFLAKE_ROLE in the engine's environment. Use a role with SELECT only for the query API.</p>
                </>
              )}
            </div>
          </Card>

          <Card title="Publish">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Postgres URL variable" hint="The URL itself is never stored in config">
                <Input className="font-mono" value={p.publish?.postgres_url_env ?? ''} placeholder="SCOREBASE_PG_URL"
                  onChange={(e) => set((x) => ({ ...x, publish: { ...x.publish, postgres_url_env: e.target.value } }))} />
              </Field>
              <Field label="Score table">
                <Input className="font-mono" value={p.publish?.table ?? ''} placeholder="entity_scores"
                  onChange={(e) => set((x) => ({ ...x, publish: { ...x.publish, table: e.target.value } }))} />
              </Field>
            </div>
          </Card>

          <Card title="Display">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Entity label (plural)"><Input value={display.entity_label ?? ''} placeholder="Customers"
                onChange={(e) => set((x) => ({ ...x, display: { ...x.display, entity_label: e.target.value } }))} /></Field>
              <Field label="Bar column" hint="A 0–1 score drawn as a bar">
                <Select value={display.highlight ?? ''} onChange={(e) => set((x) => ({ ...x, display: { ...x.display, highlight: e.target.value } }))}>
                  <option value="">None</option>
                  {scoreNames.map((s) => <option key={s}>{s}</option>)}
                </Select>
              </Field>
              <Field label="Table columns" hint="Scores shown in the members table, in order" className="col-span-full">
                <TagInput value={display.columns ?? []} suggestions={scoreNames}
                  onChange={(v) => set((x) => ({ ...x, display: { ...x.display, columns: v } }))} placeholder="Type a score name" />
              </Field>
              <Field label="Default sort">
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
          </Card>
        </div>
      )}
    </SectionFrame>
  )
}
