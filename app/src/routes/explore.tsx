// The SQL workbench: guarded, read-only SQL against the warehouse, the same checks the
// agent's SQL goes through. Worksheets live in this browser; results live in memory.
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  AlignLeft, BadgeCheck, Braces, Calendar, ChevronRight, CircleAlert, Database, Eye, Hash, History, Lock, Play, Plus, Search,
  Table2, TerminalSquare, ToggleLeft, Type, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { z } from 'zod'
import { useConfig } from '~/components/config/state'
import { ResultView } from '~/components/sql/ResultView'
import { SqlBlock, SqlEditor } from '~/components/sql/Sql'
import { useToast } from '~/components/ui/Toaster'
import { Button, Input, Kbd, Skeleton, Spinner, cx, useDismiss } from '~/components/ui'
import { PROJECT } from '~/generated/project'
import { useMe } from '~/lib/session'
import type { QueryResult, WarehouseTable } from '~/lib/types'
import { formatSql, runQuery, saveSection, warehouseTables } from '~/server/config'

export const Route = createFileRoute('/explore')({
  validateSearch: z.object({ sql: z.string().max(20_000).optional() }),
  component: Explore,
})

const HISTORY_KEY = 'scorebase.sql-history'
const TABS_KEY = 'pelagix.sql-tabs'
const SPLIT_KEY = 'pelagix.sql-split'

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {}
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const newId = () => Math.random().toString(36).slice(2, 10)

type Sheet = { id: string; name: string; sql: string }
type Outcome = { result?: QueryResult; error?: string; ran: string; ms: number; at: Date }

const starter = (): Sheet => ({ id: newId(), name: 'Query 1', sql: `SELECT *\nFROM ${PROJECT.scoreTable}\nLIMIT 20` })

function typeIcon(type: string) {
  const t = type.toLowerCase()
  if (/int|double|float|decimal|numeric|real|hugeint/.test(t)) return Hash
  if (/date|time/.test(t)) return Calendar
  if (/bool/.test(t)) return ToggleLeft
  if (/char|text|string|uuid/.test(t)) return Type
  return Braces
}

function Explore() {
  const { sql: initial } = Route.useSearch()
  const { config } = useConfig()
  const run = useServerFn(runQuery)
  const format = useServerFn(formatSql)
  const fetchTables = useServerFn(warehouseTables)
  const editor = useRef<HTMLTextAreaElement>(null)
  const pane = useRef<HTMLDivElement>(null)

  const [sheets, setSheets] = useState<Sheet[]>(() => [starter()])
  const [active, setActive] = useState<string>(() => sheets[0].id)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [tables, setTables] = useState<WarehouseTable[] | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [split, setSplit] = useState(300)
  const [cursor, setCursor] = useState({ line: 1, col: 1, selected: 0 })
  const [resultTab, setResultTab] = useState<'result' | 'executed'>('result')

  // Restore worksheets after mount (localStorage is not there during SSR). A ?sql= link opens its own sheet.
  const restored = useRef(false)
  useEffect(() => {
    fetchTables().then(setTables).catch(() => setTables([]))
  }, [fetchTables])
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const saved = read<{ sheets: Sheet[]; active: string } | null>(TABS_KEY, null)
    let list = saved?.sheets?.length ? saved.sheets : [starter()]
    let current = saved?.active && list.some((s) => s.id === saved.active) ? saved.active : list[0].id
    if (initial) {
      const same = list.find((s) => oneLine(s.sql) === oneLine(initial))
      if (same) current = same.id
      else {
        const s = { id: newId(), name: `Query ${list.length + 1}`, sql: initial }
        list = [...list, s]
        current = s.id
      }
    }
    setSheets(list)
    setActive(current)
    setHistory(read<string[]>(HISTORY_KEY, []))
    setSplit(read<number>(SPLIT_KEY, 300))
  }, [initial])

  useEffect(() => {
    if (restored.current) write(TABS_KEY, { sheets, active })
  }, [sheets, active])

  const sheet = sheets.find((s) => s.id === active) ?? sheets[0]
  const outcome = outcomes[sheet.id]
  const setSql = useCallback((sql: string) => setSheets((xs) => xs.map((s) => (s.id === active ? { ...s, sql } : s))), [active])

  // The agent and this workspace may only read the semantic model's tables and the score table.
  const allowed = useMemo(
    () => new Set([...Object.keys(config?.model.tables ?? {}), config?.project.publish?.table ?? PROJECT.scoreTable]),
    [config],
  )

  const execute = useCallback(async (override?: string) => {
    if (busy) return
    // With text selected, run just the selection, like any SQL client.
    const el = editor.current
    const selection = el && el.selectionStart !== el.selectionEnd ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
    const text = override ?? (selection.trim() || sheet.sql)
    if (!text.trim()) return
    const id = sheet.id
    setBusy(id)
    const t = performance.now()
    try {
      const result = await run({ data: { sql: text } })
      setOutcomes((o) => ({ ...o, [id]: { result, ran: text, ms: Math.round(performance.now() - t), at: new Date() } }))
      setHistory((h) => {
        const next = [text, ...h.filter((x) => oneLine(x) !== oneLine(text))].slice(0, 25)
        write(HISTORY_KEY, next)
        return next
      })
    } catch (e) {
      setOutcomes((o) => ({ ...o, [id]: { error: (e as Error).message, ran: text, ms: Math.round(performance.now() - t), at: new Date() } }))
    } finally {
      setBusy(null)
      setResultTab('result')
    }
  }, [busy, sheet, run])

  const tidy = useCallback(async () => {
    if (sheet.sql.trim()) setSql((await format({ data: { sql: sheet.sql } })).sql)
  }, [sheet.sql, format, setSql])

  // Shortcuts inside the editor: ⇧⌘F formats. (⌘↵ is handled by the editor itself.)
  useEffect(() => {
    const el = editor.current
    if (!el) return
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        tidy()
      }
    }
    const track = () => {
      const before = el.value.slice(0, el.selectionStart)
      const lines = before.split('\n')
      setCursor({ line: lines.length, col: lines[lines.length - 1].length + 1, selected: Math.abs(el.selectionEnd - el.selectionStart) })
    }
    el.addEventListener('keydown', key)
    for (const ev of ['keyup', 'click', 'select']) el.addEventListener(ev, track)
    return () => {
      el.removeEventListener('keydown', key)
      for (const ev of ['keyup', 'click', 'select']) el.removeEventListener(ev, track)
    }
  }, [tidy, active])

  /** Insert text at the cursor, or replace the selection. */
  const insert = (text: string) => {
    const el = editor.current
    if (!el) return setSql(sheet.sql + text)
    const { selectionStart: a, selectionEnd: b, value } = el
    const pad = a > 0 && !/\s|\(|,/.test(value[a - 1]) ? ' ' : ''
    setSql(value.slice(0, a) + pad + text + value.slice(b))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + pad.length + text.length, a + pad.length + text.length)
    })
  }

  const preview = (table: string) => {
    const q = `SELECT *\nFROM ${table}\nLIMIT 100`
    setSql(q)
    execute(q)
  }

  const addSheet = (sql = '') => {
    const n = Math.max(0, ...sheets.map((s) => Number(/^Query (\d+)$/.exec(s.name)?.[1] ?? 0))) + 1
    const s = { id: newId(), name: `Query ${n}`, sql }
    setSheets((xs) => [...xs, s])
    setActive(s.id)
    requestAnimationFrame(() => editor.current?.focus())
  }
  const closeSheet = (id: string) => {
    setSheets((xs) => {
      const rest = xs.filter((s) => s.id !== id)
      const next = rest.length ? rest : [starter()]
      if (id === active) setActive(next[Math.max(0, xs.findIndex((s) => s.id === id) - 1)]?.id ?? next[0].id)
      return next
    })
    setOutcomes(({ [id]: _, ...o }) => o)
  }
  const rename = (id: string, name: string) => setSheets((xs) => xs.map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)))

  // Drag the bar between editor and results to resize; the height is remembered.
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    const y0 = e.clientY
    const h0 = split
    const max = (pane.current?.clientHeight ?? 800) - 180
    let h = h0
    const move = (ev: PointerEvent) => {
      h = Math.min(max, Math.max(120, h0 + ev.clientY - y0))
      setSplit(h)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      write(SPLIT_KEY, h)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const running = busy === sheet.id
  const res = outcome?.result
  // The guard may add or lower a LIMIT; say so instead of silently running something else.
  const limited = res && outcome && !/\blimit\b/i.test(outcome.ran) && /\bLIMIT\b/.test(res.sql)

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-5.5rem)] lg:min-h-[600px] lg:flex-row">
      <SchemaPanel tables={tables} allowed={allowed} descriptions={config?.model.tables} onInsert={insert} onPreview={preview} />

      <section ref={pane} className="flex min-h-[640px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:min-h-0">
        {/* Worksheet tabs */}
        <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-subtle/60">
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto" role="tablist" aria-label="Worksheets">
            {sheets.map((s) => (
              <SheetTab key={s.id} sheet={s} active={s.id === sheet.id} running={busy === s.id} hasError={!!outcomes[s.id]?.error}
                onSelect={() => setActive(s.id)} onClose={() => closeSheet(s.id)} onRename={(n) => rename(s.id, n)} closable={sheets.length > 1} />
            ))}
            <button onClick={() => addSheet()} aria-label="New worksheet" title="New worksheet"
              className="grid w-9 shrink-0 place-items-center text-faint transition-colors hover:bg-hover hover:text-fg"><Plus className="size-4" /></button>
          </div>
          <div className="flex shrink-0 items-center gap-1 border-l border-line px-2">
            <HistoryMenu items={history} onPick={(q) => addSheet(q)} />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <Button size="sm" variant="primary" icon={<Play className="fill-current" />} loading={running} onClick={() => execute()} disabled={!sheet.sql.trim()}>
            {cursor.selected > 0 ? 'Run selection' : 'Run'}
          </Button>
          <Button size="sm" variant="ghost" icon={<AlignLeft />} onClick={tidy} disabled={!sheet.sql.trim()}>Format</Button>
          <span className="ml-auto hidden items-center gap-3 text-[11.5px] text-faint md:flex">
            <span className="flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>↵</Kbd> run</span>
            <span className="flex items-center gap-1"><Kbd>⇧</Kbd><Kbd>⌘</Kbd><Kbd>F</Kbd> format</span>
          </span>
        </div>

        {/* Editor */}
        <div className="min-h-0 shrink-0 overflow-hidden" style={{ height: split }}>
          <SqlEditor key={sheet.id} value={sheet.sql} onChange={setSql} onRun={() => execute()} minRows={12} inputRef={editor} fill
            className="h-full rounded-none border-0 bg-surface focus-within:ring-0" ariaLabel={`SQL for ${sheet.name}`} />
        </div>

        {/* Resize handle */}
        <div role="separator" aria-orientation="horizontal" aria-label="Resize editor" onPointerDown={startResize}
          className="group relative h-2 shrink-0 cursor-row-resize border-y border-line bg-subtle">
          <span className="absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong transition-colors group-hover:bg-accent" />
        </div>

        {/* Results */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-3">
            <div className="flex items-center gap-0.5" role="tablist" aria-label="Result views">
              {(['result', 'executed'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={resultTab === t} onClick={() => setResultTab(t)} disabled={!outcome}
                  className={cx('h-7 rounded-md px-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50',
                    resultTab === t ? 'bg-hover text-fg' : 'text-muted hover:text-fg')}>
                  {t === 'result' ? 'Results' : 'Executed SQL'}
                </button>
              ))}
            </div>
            {outcome && (
              <span className="flex min-w-0 items-center gap-2 truncate text-[12px] text-faint">
                {res ? (
                  <><span className="size-1.5 shrink-0 rounded-full bg-success" /><span className="num text-muted">{res.rows.length.toLocaleString()} row{res.rows.length === 1 ? '' : 's'}</span></>
                ) : <><span className="size-1.5 shrink-0 rounded-full bg-danger" /><span className="text-danger">Failed</span></>}
                <span className="num">{outcome.ms} ms</span>
                {limited && <span>· the guard added LIMIT 500</span>}
              </span>
            )}
            <div className="ml-auto">{res && <VerifyButton sql={res.sql} />}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {running && !outcome ? (
              <div className="space-y-2"><Skeleton className="h-8 w-72" /><Skeleton className="h-56" /></div>
            ) : !outcome ? (
              <EmptyResults />
            ) : resultTab === 'executed' ? (
              <SqlBlock sql={res?.sql ?? outcome.ran} label={res ? 'Executed' : 'Submitted'} meta={res ? 'after the guard' : undefined} openInWorkspace={false} maxHeight={2000} />
            ) : outcome.error ? (
              <QueryError message={outcome.error} />
            ) : res ? (
              <div className={cx(running && 'opacity-60 transition-opacity')}>
                <ResultView key={res.sql + outcome.at.getTime()} columns={res.columns} rows={res.rows} name={sheet.name.toLowerCase().replace(/\s+/g, '-')} />
              </div>
            ) : null}
          </div>
        </div>

        {/* Status bar */}
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-subtle/60 px-3 text-[11px] text-faint">
          <span className="flex items-center gap-1.5"><Database className="size-3" />{PROJECT.warehouse}</span>
          <span className="flex items-center gap-1.5"><Lock className="size-3" />read-only · 500 row cap</span>
          {running && <span className="flex items-center gap-1.5 text-accent"><Spinner className="size-3 text-accent" />running</span>}
          <span className="num ml-auto">Ln {cursor.line}, Col {cursor.col}{cursor.selected > 0 && ` (${cursor.selected} selected)`}</span>
          {outcome && <span className="hidden sm:inline">ran {outcome.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
        </footer>
      </section>
    </div>
  )
}

// ---------- schema browser ----------

function SchemaPanel({ tables, allowed, descriptions, onInsert, onPreview }: {
  tables: WarehouseTable[] | null
  allowed: Set<string>
  descriptions?: Record<string, { description?: string; columns: Record<string, string> }>
  onInsert: (text: string) => void
  onPreview: (table: string) => void
}) {
  const [q, setQ] = useState('')
  const visible = (tables ?? []).filter((t) => allowed.has(t.name))
  const hidden = (tables ?? []).filter((t) => !allowed.has(t.name))
  const needle = q.trim().toLowerCase()
  const shown = visible
    .map((t) => ({ t, cols: needle && !t.name.toLowerCase().includes(needle) ? t.columns.filter((c) => c.name.toLowerCase().includes(needle)) : t.columns }))
    .filter(({ t, cols }) => !needle || t.name.toLowerCase().includes(needle) || cols.length > 0)

  return (
    <aside className="flex max-h-[420px] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:max-h-none lg:w-[264px]">
      <div className="shrink-0 border-b border-line p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold">Schema</h2>
          <span className="text-[11px] text-faint">{visible.length} tables</span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a table or column" aria-label="Find a table or column" className="h-7 pl-8 text-[12.5px]" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!tables ? (
          <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}</div>
        ) : shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-faint">Nothing matches “{q}”.</p>
        ) : shown.map(({ t, cols }) => (
          <details key={t.name} className="group/t" open={!!needle || undefined}>
            <summary className="group/s flex cursor-pointer list-none items-center gap-1.5 py-1.5 pl-2.5 pr-1.5 text-[13px] hover:bg-hover">
              <ChevronRight className="size-3.5 shrink-0 text-faint transition-transform group-open/t:rotate-90" />
              <Table2 className="size-3.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={descriptions?.[t.name]?.description}>{t.name}</span>
              <span className="num text-[10.5px] text-faint group-hover/s:hidden">{t.rows.toLocaleString()}</span>
              <span className="hidden items-center group-hover/s:flex">
                <IconAction label={`Insert ${t.name}`} onClick={() => onInsert(t.name)}><Plus /></IconAction>
                <IconAction label={`Preview ${t.name}`} onClick={() => onPreview(t.name)}><Eye /></IconAction>
              </span>
            </summary>
            <ul className="relative pb-1 before:absolute before:bottom-2 before:left-[17px] before:top-0 before:w-px before:bg-line">
              {cols.map((c) => {
                const I = typeIcon(c.type)
                return (
                  <li key={c.name}>
                    <button onClick={() => onInsert(c.name)} title={descriptions?.[t.name]?.columns[c.name] || `Insert ${c.name}`}
                      className="flex w-full items-center gap-2 py-[3px] pl-7 pr-3 text-left font-mono text-[11.5px] text-muted hover:bg-hover hover:text-fg">
                      <I className="size-3 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="shrink-0 text-[10px] uppercase text-faint">{c.type.toLowerCase().replace(/\(.*\)/, '')}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </details>
        ))}
      </div>
      {hidden.length > 0 && (
        <p className="shrink-0 border-t border-line px-3 py-2 text-[11px] leading-snug text-faint" title={hidden.map((t) => t.name).join(', ')}>
          {hidden.length} table{hidden.length === 1 ? '' : 's'} hidden: not in the semantic model
        </p>
      )}
    </aside>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }}
      className="grid size-6 place-items-center rounded text-faint hover:bg-surface hover:text-fg [&_svg]:size-3.5">
      {children}
    </button>
  )
}

// ---------- worksheet tab ----------

function SheetTab({ sheet, active, running, hasError, closable, onSelect, onClose, onRename }: {
  sheet: Sheet; active: boolean; running: boolean; hasError: boolean; closable: boolean
  onSelect: () => void; onClose: () => void; onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div role="tab" aria-selected={active} onClick={onSelect} onDoubleClick={() => setEditing(true)} title="Double-click to rename"
      className={cx('group relative flex max-w-[200px] shrink-0 cursor-pointer items-center gap-2 border-r border-line pl-3 pr-1.5 text-[12.5px] transition-colors',
        active ? 'bg-surface text-fg' : 'text-muted hover:bg-hover hover:text-fg')}>
      {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-brand" />}
      {running ? <Spinner className="size-3" /> : <TerminalSquare className={cx('size-3.5 shrink-0', hasError ? 'text-danger' : active ? 'text-accent' : 'text-faint')} />}
      {editing ? (
        <input autoFocus defaultValue={sheet.name} aria-label="Worksheet name" onClick={(e) => e.stopPropagation()}
          onBlur={(e) => { onRename(e.target.value); setEditing(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false) }}
          className="w-24 rounded border border-accent bg-surface px-1 text-[12.5px] outline-none" />
      ) : <span className="truncate">{sheet.name}</span>}
      {closable && (
        <button onClick={(e) => { e.stopPropagation(); onClose() }} aria-label={`Close ${sheet.name}`}
          className={cx('grid size-5 place-items-center rounded text-faint hover:bg-hover hover:text-fg', !active && 'opacity-0 group-hover:opacity-100')}>
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

// ---------- results helpers ----------

function EmptyResults() {
  return (
    <div className="grid h-full min-h-48 place-items-center text-center">
      <div>
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl border border-line bg-subtle text-faint shadow-card"><TerminalSquare className="size-5" /></div>
        <p className="text-[13px] font-medium">Run a query to see results</p>
        <p className="mt-1 text-[12px] text-faint">Press <Kbd>⌘</Kbd> <Kbd>↵</Kbd>, or pick a table on the left to preview it.</p>
      </div>
    </div>
  )
}

function QueryError({ message }: { message: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-danger/30 bg-danger-subtle p-4">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-danger">Query failed</p>
        <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[12px] text-fg">{message}</pre>
      </div>
    </div>
  )
}

/** Save the executed SQL as the verified answer to a question (golden.yaml). Editors only. */
function VerifyButton({ sql }: { sql: string }) {
  const { config, reload } = useConfig()
  const { can } = useMe()
  const toast = useToast()
  const save = useServerFn(saveSection)
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const ref = useDismiss(open, () => setOpen(false))
  if (!can('editor')) return null
  const verify = async () => {
    if (!config || question.trim().length < 3) return
    const r = await save({ data: { section: 'golden', data: [...config.golden, { question: question.trim(), sql }] } })
    if (r.errors.length) toast({ title: 'Not saved', description: r.errors.join('; '), tone: 'danger' })
    else {
      toast({ title: 'Saved as a verified query', description: `“${question.trim()}” is now answered with this SQL.`, tone: 'success' })
      setQuestion('')
      setOpen(false)
      reload()
    }
  }
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="ghost" icon={<BadgeCheck />} onClick={() => setOpen(!open)} aria-expanded={open}>Save as verified</Button>
      {open && (
        <div className="anim-rise absolute right-0 top-full z-20 mt-1 w-80 rounded-lg border border-line bg-surface p-3 shadow-lg">
          <p className="mb-2 text-[12px] text-muted">The agent will answer this question with the executed SQL.</p>
          <Input autoFocus value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Who are our top customers?"
            onKeyDown={(e) => e.key === 'Enter' && verify()} />
          <div className="mt-2 flex justify-end"><Button size="sm" variant="primary" onClick={verify} disabled={question.trim().length < 3}>Save</Button></div>
        </div>
      )}
    </div>
  )
}

function HistoryMenu({ items, onPick }: { items: string[]; onPick: (sql: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="ghost" icon={<History />} onClick={() => setOpen(!open)} aria-expanded={open} disabled={!items.length}>History</Button>
      {open && (
        <div className="anim-rise absolute right-0 top-full z-20 mt-1 w-[460px] max-w-[80vw] overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <p className="border-b border-line px-3 py-2 text-[11px] font-medium text-faint">Recent queries · opens in a new worksheet</p>
          <div className="max-h-80 overflow-y-auto p-1">
            {items.map((h) => (
              <button key={h} onClick={() => { onPick(h); setOpen(false) }} title={h}
                className="block w-full truncate rounded-md px-2.5 py-1.5 text-left font-mono text-[12px] text-muted hover:bg-hover hover:text-fg">
                {oneLine(h)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
