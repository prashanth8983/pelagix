// Guarded SQL against the warehouse: the same checks the agent's SQL goes through.
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { BadgeCheck, ChevronRight, History, Play, Table2, WandSparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { useConfig } from '~/components/config/state'
import { ResultView } from '~/components/ResultView'
import { SqlBlock, SqlEditor } from '~/components/Sql'
import { useToast } from '~/components/Toaster'
import { Badge, Button, Callout, Card, Input, Kbd, PageHeader, cx, useDismiss } from '~/components/ui'
import { PROJECT } from '~/generated/project'
import { useMe } from '~/lib/session'
import type { QueryResult, WarehouseTable } from '~/lib/types'
import { formatSql, runQuery, saveSection, warehouseTables } from '~/server/config'

export const Route = createFileRoute('/explore')({
  validateSearch: z.object({ sql: z.string().max(20_000).optional() }),
  component: Explore,
})

const HISTORY_KEY = 'scorebase.sql-history'
const loadHistory = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    return []
  }
}
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

function Explore() {
  const { sql: initial } = Route.useSearch()
  const { config, reload } = useConfig()
  const { can } = useMe()
  const toast = useToast()
  const run = useServerFn(runQuery)
  const format = useServerFn(formatSql)
  const save = useServerFn(saveSection)
  const fetchTables = useServerFn(warehouseTables)
  const [sql, setSql] = useState(initial ?? `SELECT *\nFROM ${PROJECT.scoreTable}\nLIMIT 20`)
  const [res, setRes] = useState<QueryResult | null>(null)
  const [ran, setRan] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ms, setMs] = useState<number | null>(null)
  const [tables, setTables] = useState<WarehouseTable[]>([])
  const [history, setHistory] = useState<string[]>([])
  const [question, setQuestion] = useState('')
  const [showRan, setShowRan] = useState(false)

  useEffect(() => {
    setHistory(loadHistory())
    fetchTables().then(setTables).catch(() => {})
  }, [fetchTables])
  useEffect(() => {
    if (initial) setSql(initial)
  }, [initial])

  // The agent and this workspace may only read the semantic model's tables and the score table.
  const allowed = useMemo(
    () => new Set([...Object.keys(config?.model.tables ?? {}), config?.project.publish?.table ?? PROJECT.scoreTable]),
    [config],
  )

  const execute = async () => {
    if (!sql.trim() || busy) return
    setBusy(true)
    setErr(null)
    const t = performance.now()
    try {
      const r = await run({ data: { sql } })
      setRes(r)
      setRan(sql)
      setMs(Math.round(performance.now() - t))
      const h = [sql, ...history.filter((x) => oneLine(x) !== oneLine(sql))].slice(0, 15)
      setHistory(h)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h))
      } catch {}
    } catch (e) {
      setErr((e as Error).message)
      setRes(null)
    } finally {
      setBusy(false)
    }
  }

  const tidy = async () => setSql((await format({ data: { sql } })).sql)

  const verify = async () => {
    if (!config || !res || question.trim().length < 3) return
    const r = await save({ data: { section: 'golden', data: [...config.golden, { question: question.trim(), sql: res.sql }] } })
    if (r.errors.length) toast({ title: 'Not saved', description: r.errors.join('; '), tone: 'danger' })
    else {
      toast({ title: 'Saved as a verified query', description: `“${question.trim()}” is now answered with this SQL.`, tone: 'success' })
      setQuestion('')
      reload()
    }
  }

  // The guard may add or lower a LIMIT; say so instead of silently running something else.
  const limited = res && !/\blimit\b/i.test(ran) && /\bLIMIT\b/.test(res.sql)

  return (
    <>
      <PageHeader title="SQL workspace" description="Read-only SQL through the same guard as the agent: one SELECT, known tables, at most 500 rows." />
      <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <Card title="Tables" padded={false} className="self-start lg:sticky lg:top-20">
          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto py-1.5">
            {tables.filter((t) => allowed.has(t.name)).map((t) => (
              <details key={t.name} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-hover">
                  <ChevronRight className="size-3.5 shrink-0 text-faint transition-transform group-open:rotate-90" />
                  <Table2 className="size-3.5 shrink-0 text-faint" />
                  <span className="flex-1 truncate font-mono text-[12px]">{t.name}</span>
                  <span className="num text-[11px] text-faint">{t.rows.toLocaleString()}</span>
                </summary>
                <ul className="pb-1.5">
                  {t.columns.map((c) => (
                    <li key={c.name}>
                      <button
                        className="flex w-full items-center justify-between gap-2 py-1 pl-10 pr-3 text-left font-mono text-[11.5px] text-muted hover:bg-hover hover:text-fg"
                        onClick={() => setSql((s) => s + (/\s$/.test(s) ? '' : ' ') + c.name)}
                        title={config?.model.tables[t.name]?.columns[c.name] || 'Insert column name'}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 text-[10.5px] text-faint">{c.type.toLowerCase()}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {tables.some((t) => !allowed.has(t.name)) && (
              <p className="border-t border-line px-3 pb-1.5 pt-2.5 text-[11px] text-faint">
                Hidden (not in the semantic model): {tables.filter((t) => !allowed.has(t.name)).map((t) => t.name).join(', ')}
              </p>
            )}
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          <section className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" icon={<WandSparkles />} onClick={tidy} disabled={!sql.trim()}>Format</Button>
                {history.length > 0 && <HistoryMenu items={history} onPick={setSql} />}
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden items-center gap-1 text-[12px] text-faint md:flex"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
                <Button size="sm" variant="primary" icon={<Play />} loading={busy} onClick={execute} disabled={!sql.trim()}>Run</Button>
              </div>
            </div>
            <SqlEditor value={sql} onChange={setSql} onRun={execute} minRows={10} className="rounded-none border-0 focus-within:ring-0" />
          </section>

          {err && <Callout tone="danger" title="Query failed"><span className="whitespace-pre-wrap font-mono text-[12px]">{err}</span></Callout>}

          {res && (
            <Card
              title={<span className="flex items-center gap-2">Result <Badge>{res.rows.length.toLocaleString()} row{res.rows.length === 1 ? '' : 's'}</Badge></span>}
              description={[ms != null && `${ms} ms`, limited && 'the guard added LIMIT 500'].filter(Boolean).join(' · ') || undefined}
              actions={<Button size="sm" variant="ghost" onClick={() => setShowRan(!showRan)}>{showRan ? 'Hide' : 'Show'} executed SQL</Button>}
            >
              {showRan && <SqlBlock className="mb-4" sql={res.sql} label="Executed" meta="after the guard" openInWorkspace={false} />}
              <ResultView key={res.sql} columns={res.columns} rows={res.rows} name="query" />
              {can('editor') && (
                <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
                  <BadgeCheck className="hidden size-4 shrink-0 text-faint sm:block" />
                  <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Save as a verified query: the question this SQL answers"
                    onKeyDown={(e) => e.key === 'Enter' && verify()} />
                  <Button onClick={verify} disabled={question.trim().length < 3}>Save</Button>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function HistoryMenu({ items, onPick }: { items: string[]; onPick: (sql: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="ghost" icon={<History />} onClick={() => setOpen(!open)} aria-expanded={open}>Recent</Button>
      {open && (
        <div className="anim-rise absolute left-0 top-full z-20 mt-1 w-[440px] max-w-[80vw] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-lg shadow-black/5">
          {items.map((h) => (
            <button key={h} onClick={() => { onPick(h); setOpen(false) }}
              className={cx('block w-full truncate rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] text-muted hover:bg-hover hover:text-fg')} title={h}>
              {oneLine(h)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

