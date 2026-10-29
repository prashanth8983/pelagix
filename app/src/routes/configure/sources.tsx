import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { DetailHeader, Group, MasterDetail, type ListItem } from '~/components/config/MasterDetail'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useSection } from '~/components/config/state'
import { Badge, Button, Code, DataTable, Field, Input, KeyValueEditor, Select, TagInput } from '~/components/ui'
import { clean, errorsAt, move, parseLiteral, remove, replace, showLiteral, uniqueName } from '~/lib/edit'
import { CONNECTORS, type Source, type WarehouseTable } from '~/lib/types'
import { previewSource, warehouseTables } from '~/server/config'

export const Route = createFileRoute('/configure/sources')({
  validateSearch: z.object({ item: z.union([z.string(), z.number()]).transform(String).optional() }),
  component: SourcesPage,
})

type Preview = { columns: { name: string; type: string }[]; rows: (string | number | boolean | null)[][] }

function SourcesPage() {
  const editor = useSection('sources')
  const { item } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const fetchTables = useServerFn(warehouseTables)
  const [landed, setLanded] = useState<Record<string, WarehouseTable>>({})
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const sources = editor.value ?? []
  const errs = editor.errors
  const i = Math.min(Number(item ?? 0) || 0, Math.max(sources.length - 1, 0))
  const selected = sources.length ? String(i) : null
  const select = (key: string) => navigate({ search: { item: key }, replace: true })

  useEffect(() => {
    fetchTables().then((ts) => setLanded(Object.fromEntries(ts.map((t) => [t.name, t])))).catch(() => {})
  }, [fetchTables])

  const update = (s: Source) => editor.set((xs) => replace(xs, i, clean(s)))
  const add = () => {
    editor.set((xs) => [...xs, { name: uniqueName(xs.map((x) => x.name), 'new_source'), connector: 'csv', path: 'data/' }])
    select(String(sources.length))
  }

  const items: ListItem[] = sources.map((s, j) => {
    const t = landed[s.name]
    const bad = errorsAt(errs, `${j}`)
    return {
      key: String(j),
      title: <span className="font-mono">{s.name}</span>,
      subtitle: s.connector === 'postgres' ? `postgres · ${s.table ?? 'query'}` : s.path,
      badge: bad ? 'invalid' : t ? `${t.rows.toLocaleString()} rows` : 'not loaded',
      tone: bad ? 'danger' : t ? 'accent' : 'warning',
      text: `${s.name} ${s.path ?? ''} ${s.table ?? ''} ${s.connector ?? ''}`,
    }
  })
  const s = sources[i]

  return (
    <SectionFrame section="sources" title="Sources" editor={editor} actions={<Button icon={<Plus />} onClick={add}>New source</Button>}>
      <MasterDetail
        items={items}
        selected={selected}
        onSelect={select}
        onNew={add}
        newLabel="New source"
        searchPlaceholder="Search sources"
        emptyTitle="No sources yet"
        emptyHint="Add the raw tables the scores read from. Each one becomes a table in the warehouse."
      >
        {s && (
          <>
            <DetailHeader
              title={<span className="font-mono">{s.name}</span>}
              subtitle={landed[s.name] ? `Landed: ${landed[s.name].rows.toLocaleString()} rows, ${landed[s.name].columns.length} columns` : 'Not loaded yet. It lands on the next pipeline run.'}
              onUp={i > 0 ? () => editor.set((xs) => move(xs, i, -1)) : undefined}
              onDown={i < sources.length - 1 ? () => editor.set((xs) => move(xs, i, 1)) : undefined}
              onDuplicate={() => {
                editor.set((xs) => [...xs, { ...s, name: uniqueName(xs.map((x) => x.name), s.name) }])
                select(String(sources.length))
              }}
              onRemove={() => {
                editor.set((xs) => remove(xs, i))
                select(String(Math.max(0, i - 1)))
              }}
            />
            <SourceForm
              source={s}
              index={i}
              errors={errs}
              onChange={update}
              preview={previews[s.name]}
              onPreview={(p) => setPreviews((ps) => ({ ...ps, [s.name]: p }))}
              knownColumns={previews[s.name]?.columns.map((c) => c.name) ?? landed[s.name]?.columns.map((c) => c.name) ?? []}
            />
          </>
        )}
      </MasterDetail>
    </SectionFrame>
  )
}

function SourceForm({ source: s, index, errors, onChange, preview, onPreview, knownColumns }: {
  source: Source
  index: number
  errors: string[]
  onChange: (s: Source) => void
  preview?: Preview
  onPreview: (p: Preview) => void
  knownColumns: string[]
}) {
  const run = useServerFn(previewSource)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const pg = s.connector === 'postgres'
  const checks = s.checks ?? {}
  const options = Object.fromEntries(Object.entries(s.options ?? {}).map(([k, v]) => [k, showLiteral(v)]))
  const at = (field: string) => errorsAt(errors, `${index}.${field}`)
  const whole = errorsAt(errors, `${index}`)

  const doPreview = async () => {
    setBusy(true)
    setErr(null)
    try {
      onPreview(await run({ data: { source: s } }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Group title="Connection" help="Where the rows come from. The table in the warehouse takes the source's name.">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Table name" error={at('name')}>
            <Input className="font-mono" value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value })} />
          </Field>
          <Field label="Connector">
            <Select value={s.connector ?? 'csv'} onChange={(e) => onChange({ ...s, connector: e.target.value as Source['connector'] })}>
              {CONNECTORS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
          {pg ? (
            <>
              <Field label="URL variable" hint="Env var with the Postgres URL" error={at('dsn_env')}>
                <Input className="font-mono" value={s.dsn_env ?? ''} onChange={(e) => onChange({ ...s, dsn_env: e.target.value })} placeholder="SOURCE_PG_URL" />
              </Field>
              <Field label="Table" hint="schema.table">
                <Input className="font-mono" value={s.table ?? ''} onChange={(e) => onChange({ ...s, table: e.target.value })} placeholder="public.users" />
              </Field>
            </>
          ) : (
            <Field label="Path" hint="File or glob under data/, or an allowed URL" className="md:col-span-2" error={at('path') ?? whole}>
              <Input className="font-mono" value={s.path ?? ''} onChange={(e) => onChange({ ...s, path: e.target.value })} />
            </Field>
          )}
        </div>
        {pg && (
          <Field label="Query" hint="Leave empty to copy the whole table" className="mt-4">
            <Code value={s.query ?? ''} onChange={(e) => onChange({ ...s, query: e.target.value })} rows={3} />
          </Field>
        )}
      </Group>

      <Group title="Loading" help="How each run refreshes the table.">
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Mode" hint={s.mode === 'incremental' ? 'Appends rows past the last cursor value' : 'Replaces the table on every run'}>
            <Select value={s.mode ?? 'replace'} onChange={(e) => onChange({ ...s, mode: e.target.value as Source['mode'] })}>
              <option value="replace">Replace</option>
              <option value="incremental">Incremental</option>
            </Select>
          </Field>
          {s.mode === 'incremental' && (
            <Field label="Cursor column" hint="A column that only increases" error={at('cursor')}>
              <Input className="font-mono" list={`cols-${s.name}`} value={s.cursor ?? ''} onChange={(e) => onChange({ ...s, cursor: e.target.value })} placeholder="updated_at" />
              <datalist id={`cols-${s.name}`}>{knownColumns.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          )}
        </div>
        {!pg && (
          <div className="mt-4">
            <p className="mb-1 text-[12px] font-medium">Reader options</p>
            <p className="mb-2 text-[12px] text-muted">
              Passed to the file reader, for example <span className="font-mono">delim = ;</span>, <span className="font-mono">header = true</span> or{' '}
              <span className="font-mono">{'types = {"zip": "VARCHAR"}'}</span>. Usually none are needed.
            </p>
            <KeyValueEditor mono keyLabel="Option" valueLabel="Value" value={options} addLabel="Add option"
              onChange={(o) => onChange({ ...s, options: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, parseLiteral(v)])) })} />
          </div>
        )}
      </Group>

      <Group title="Checks" help="Run after loading. If any fails, the run stops before scoring or publishing.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Required columns"><TagInput value={checks.columns ?? []} suggestions={knownColumns} placeholder="Column names" onChange={(v) => onChange({ ...s, checks: { ...checks, columns: v } })} /></Field>
          <Field label="Never null"><TagInput value={checks.not_null ?? []} suggestions={knownColumns} placeholder="Column names" onChange={(v) => onChange({ ...s, checks: { ...checks, not_null: v } })} /></Field>
          <Field label="Unique"><TagInput value={checks.unique ?? []} suggestions={knownColumns} placeholder="Column names" onChange={(v) => onChange({ ...s, checks: { ...checks, unique: v } })} /></Field>
          <Field label="Minimum rows">
            <Input type="number" min={0} value={checks.min_rows ?? ''}
              onChange={(e) => onChange({ ...s, checks: { ...checks, min_rows: e.target.value === '' ? null : Number(e.target.value) } })} />
          </Field>
        </div>
      </Group>

      <Group title="Preview" help="Reads the first 20 rows and the inferred column types without loading anything.">
        <div className="flex items-center gap-3">
          <Button onClick={doPreview} disabled={busy} loading={busy}>Preview source</Button>
          {preview && <Badge>{preview.columns.length} columns</Badge>}
        </div>
        {err && <p className="mt-3 font-mono text-[12px] text-danger">{err}</p>}
        {preview && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {preview.columns.map((c) => (
                <span key={c.name} className="rounded-md border border-line px-2 py-0.5 font-mono text-[11px]">
                  {c.name} <span className="text-muted">{c.type.toLowerCase()}</span>
                </span>
              ))}
            </div>
            <DataTable columns={preview.columns.map((c) => c.name)} rows={preview.rows} />
          </div>
        )}
      </Group>
    </>
  )
}
