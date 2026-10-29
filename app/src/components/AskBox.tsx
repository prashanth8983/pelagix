import { useServerFn } from '@tanstack/react-start'
import { ArrowUp, BadgeCheck, ChevronDown, Code2, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMe } from '~/lib/session'
import { ask, type AskResponse } from '~/server/ask'
import { saveSection } from '~/server/config'
import { useConfig } from './config/state'
import { ResultView } from './ResultView'
import { useToast } from './Toaster'
import { SqlBlock } from './Sql'
import { Badge, Button, Spinner, cx } from './ui'

export function AskBox({ initial }: { initial?: string }) {
  const run = useServerFn(ask)
  const save = useServerFn(saveSection)
  const { config, reload } = useConfig()
  const { can } = useMe()
  const toast = useToast()
  const [q, setQ] = useState(initial ?? '')
  const [asked, setAsked] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AskResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showSql, setShowSql] = useState(false)
  const [saved, setSaved] = useState(false)
  const [focused, setFocused] = useState(false)
  // Until React has hydrated, Enter would do a native form GET and reload the page.
  const [ready, setReady] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setReady(true), [])

  const suggestions = (config?.golden ?? []).slice(0, 4).map((g) => g.question)

  const submit = async (question: string) => {
    if (!question.trim()) return
    setQ(question)
    setAsked(question.trim())
    setBusy(true)
    setErr(null)
    setSaved(false)
    setShowSql(false)
    try {
      setRes(await run({ data: { question } }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (initial && ready) submit(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, ready])

  // A checked agent answer becomes a verified query: answered instantly and exactly next
  // time, and one more example for the agent.
  const verify = async () => {
    if (!config || !res?.sql) return
    const r = await save({ data: { section: 'golden', data: [...config.golden, { question: asked, sql: res.sql }] } })
    if (r.errors.length) toast({ title: 'Not saved', description: r.errors.join('; '), tone: 'danger' })
    else {
      setSaved(true)
      reload()
      toast({ title: 'Saved as a verified query', description: 'This question is now answered with this SQL.', tone: 'success' })
    }
  }

  return (
    <section className={cx('rounded-lg border bg-surface transition-[border-color,box-shadow]', focused ? 'border-accent ring-3 ring-ring' : 'border-line')}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(q)
        }}
        className="flex items-center gap-3 px-4"
      >
        <Sparkles className="size-4 shrink-0 text-faint" strokeWidth={1.75} />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={!ready}
          placeholder="Ask a question about your data"
          className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
        />
        {res && !busy && (
          <Button variant="ghost" size="sm" aria-label="Clear" icon={<X />} onClick={() => { setRes(null); setQ(''); setErr(null); input.current?.focus() }} />
        )}
        <Button type="submit" variant="primary" size="sm" aria-label="Ask" disabled={!ready || !q.trim()} loading={busy} icon={<ArrowUp />} />
      </form>

      {!res && !busy && !err && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="h-7 rounded-md border border-line px-2.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[13px] text-muted">
          <Spinner /> Working on “{asked}”
        </div>
      )}
      {err && <p className="border-t border-line px-4 py-3 text-[13px] text-danger">{err}</p>}

      {res && !busy && (
        <div className="anim-fade border-t border-line px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[14px] leading-relaxed">{res.answer.replace(/\*\*/g, '')}</p>
            {res.source === 'verified' ? <Badge tone="success"><BadgeCheck className="size-3" />Verified</Badge>
              : res.source === 'agent' ? <Badge tone="accent">Generated</Badge>
              : <Badge>No answer</Badge>}
          </div>

          {res.closest && (
            <button onClick={() => submit(res.closest!)} className="mt-2 text-[13px] text-accent hover:underline">
              Ask “{res.closest}” instead
            </button>
          )}

          {res.columns && res.rows && <div className="mt-4"><ResultView key={res.sql ?? asked} columns={res.columns} rows={res.rows} name="answer" /></div>}

          {res.sql && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" icon={<Code2 />} onClick={() => setShowSql(!showSql)} className="-ml-2" aria-expanded={showSql}>
                {showSql ? 'Hide SQL' : 'View SQL'}
                <ChevronDown className={cx('transition-transform', showSql && 'rotate-180')} />
              </Button>
              <span className="text-[12px] text-faint">{res.rows?.length ?? 0} rows{res.attempts ? ` · ${res.attempts} attempt${res.attempts > 1 ? 's' : ''}` : ''}</span>
              {res.source === 'agent' && can('editor') && !saved && (
                <Button size="sm" className="ml-auto" icon={<BadgeCheck />} onClick={verify} title="Check the SQL first: verified answers are shown as exact">
                  Save as verified
                </Button>
              )}
            </div>
          )}
          {showSql && res.sql && (
            <SqlBlock
              className="anim-fade mt-2"
              sql={res.sql}
              label={res.source === 'verified' ? 'Verified query' : 'Generated query'}
              meta={res.source === 'verified' ? res.matched : 'Checked by the SQL guard before it ran'}
            />
          )}
        </div>
      )}
    </section>
  )
}
