import { Plus } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { ItemCard } from '~/components/config/ItemCard'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useSection } from '~/components/config/state'
import { Badge, Button, Code, DataTable, Field, Input, KeyValueEditor, Select, TagInput } from '~/components/ui'
import { clean, move, parseLiteral, remove, replace, showLiteral, uniqueName } from '~/lib/edit'
import { CONNECTORS, type Source, type WarehouseTable } from '~/lib/types'
import { previewSource, warehouseTables } from '~/server/config'

export const Route = createFileRoute('/configure/sources')({ component: SourcesPage })

type Preview = { columns: { name: string; type: string }[]; rows: (string | number | boolean | null)[][] }

function SourcesPage() {
  const editor = useSection('sources')
  const fetchTables = useServerFn(warehouseTables)
  const [open, setOpen] = useState<number | null>(null)
  const [landed, setLanded] = useState<Record<string, WarehouseTable>>({})
  const [previews, setPreviews] = useState<Record<string, Preview>>({})
  const sources = editor.value ?? []

  useEffect(() => {
    fetchTables().then((ts) => setLanded(Object.fromEntries(ts.map((t) => [t.name, t])))).catch(() => {})
  }, [fetchTables])

  const update = (i: number, s: Source) => editor.set((xs) => replace(xs, i, clean(s)))
  const add = () => {
    editor.set((xs) => [...xs, { name: uniqueName(xs.map((x) => x.name), 'new_source'), connector: 'csv', path: 'data/' }])
    setOpen(sources.length)
  }

  return (
    <SectionFrame
      section="sources"
      title="Sources"
      editor={editor}
      description="Raw tables loaded on every run, then checked before anything is scored."
      actions={<Button icon={<Plus />} onClick={add}>New source</Button>}
    >
      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {sources.map((s, i) => {
          const t = landed[s.name]
          const where = s.connector === 'postgres' ? `postgres · ${s.table ?? 'query'}` : s.path
          const checks = s.checks ? Object.values(s.checks).flat().filter((x) => x != null).length : 0
          return (
            <ItemCard
              key={i}
              title={<span className="font-mono">{s.name}</span>}
              subtitle={`${s.connector ?? 'csv'} · ${where ?? ''}`}
              badges={<>
                {s.mode === 'incremental' && <Badge tone="accent">incremental</Badge>}
                {checks > 0 && <Badge tone="success">{checks} checks</Badge>}
                {t ? <Badge>{t.rows.toLocaleString()} rows</Badge> : <Badge tone="warning">not loaded</Badge>}
              </>}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              onUp={i > 0 ? () => editor.set((xs) => move(xs, i, -1)) : undefined}
              onDown={i < sources.length - 1 ? () => editor.set((xs) => move(xs, i, 1)) : undefined}
              onDuplicate={() => editor.set((xs) => [...xs, { ...s, name: uniqueName(xs.map((x) => x.name), s.name) }])}
              onRemove={() => editor.set((xs) => remove(xs, i))}
            >
              <SourceForm
                source={s}
                onChange={(x) => update(i, x)}
                preview={previews[s.name]}
                onPreview={(p) => setPreviews((ps) => ({ ...ps, [s.name]: p }))}
                knownColumns={previews[s.name]?.columns.map((c) => c.name) ?? t?.columns.map((c) => c.name) ?? []}
              />
            </ItemCard>
          )
        })}
      </div>
    </SectionFrame>
  )
}

function SourceForm({ source: s, onChange, preview, onPreview, knownColumns }: {
  source: Source
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
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Table name"><Input className="font-mono" value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value })} /></Field>
        <Field label="Connector">
          <Select value={s.connector ?? 'csv'} onChange={(e) => onChange({ ...s, connector: e.target.value as Source['connector'] })}>
            {CONNECTORS.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        {pg ? (
          <>
            <Field label="DSN variable" hint="Env var holding the Postgres URL">
              <Input className="font-mono" value={s.dsn_env ?? ''} onChange={(e) => onChange({ ...s, dsn_env: e.target.value })} placeholder="SOURCE_PG_URL" />
            </Field>
            <Field label="Table" hint="schema.table">
              <Input className="font-mono" value={s.table ?? ''} onChange={(e) => onChange({ ...s, table: e.target.value })} placeholder="public.users" />
            </Field>
          </>
        ) : (
          <Field label="Path" hint="File, glob, or s3:// / gs:// / https:// URL" className="md:col-span-2">
            <Input className="font-mono" value={s.path ?? ''} onChange={(e) => onChange({ ...s, path: e.target.value })} />
          </Field>
        )}
      </div>
      {pg && (
        <Field label="Query (instead of a table)" hint="Runs on the source database; leave empty to copy the table">
          <Code value={s.query ?? ''} onChange={(e) => onChange({ ...s, query: e.target.value })} rows={3} />
        </Field>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Load mode" hint={s.mode === 'incremental' ? 'Appends rows newer than the table’s max cursor' : 'Replaces the table each run'}>
          <Select value={s.mode ?? 'replace'} onChange={(e) => onChange({ ...s, mode: e.target.value as Source['mode'] })}>
            <option value="replace">Replace</option>
            <option value="incremental">Incremental</option>
          </Select>
        </Field>
        {s.mode === 'incremental' && (
          <Field label="Cursor column">
            <Input className="font-mono" list={`cols-${s.name}`} value={s.cursor ?? ''} onChange={(e) => onChange({ ...s, cursor: e.target.value })} placeholder="updated_at" />
            <datalist id={`cols-${s.name}`}>{knownColumns.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
        )}
      </div>

      {!pg && (
        <div>
          <p className="mb-2 text-[12px] font-medium text-fg">Reader options</p>
          <p className="mb-2 text-[12px] text-muted">
            Passed to DuckDB’s reader, e.g. <span className="font-mono">delim = ;</span>, <span className="font-mono">header = true</span>,{' '}
            <span className="font-mono">{'types = {"zip": "VARCHAR"}'}</span>.
          </p>
          <KeyValueEditor mono keyLabel="Option" valueLabel="Value" value={options}
            onChange={(o) => onChange({ ...s, options: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, parseLiteral(v)])) })} />
        </div>
      )}

      <div>
        <p className="mb-2 text-[12px] font-medium text-fg">Checks</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Required columns"><TagInput value={checks.columns ?? []} suggestions={knownColumns} onChange={(v) => onChange({ ...s, checks: { ...checks, columns: v } })} /></Field>
          <Field label="Never null"><TagInput value={checks.not_null ?? []} suggestions={knownColumns} onChange={(v) => onChange({ ...s, checks: { ...checks, not_null: v } })} /></Field>
          <Field label="Unique"><TagInput value={checks.unique ?? []} suggestions={knownColumns} onChange={(v) => onChange({ ...s, checks: { ...checks, unique: v } })} /></Field>
          <Field label="Minimum rows">
            <Input type="number" min={0} value={checks.min_rows ?? ''}
              onChange={(e) => onChange({ ...s, checks: { ...checks, min_rows: e.target.value === '' ? null : Number(e.target.value) } })} />
          </Field>
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <div className="flex items-center gap-3">
          <Button onClick={doPreview} disabled={busy}>{busy ? 'Reading…' : 'Preview source'}</Button>
          <span className="text-[12px] text-muted">Reads the first 20 rows and the inferred column types without loading anything.</span>
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
      </div>
    </div>
  )
}
