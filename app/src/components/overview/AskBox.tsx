import { useServerFn } from '@tanstack/react-start'
import { ArrowUp, BadgeCheck, ChevronDown, Code2, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useMe } from '~/lib/session'
import { ask, type AskResponse } from '~/server/ask'
import { saveSection } from '~/server/config'
import { useConfig } from '~/components/config/state'
import { ResultView } from '~/components/sql/ResultView'
import { useToast } from '~/components/ui/Toaster'
import { SqlBlock } from '~/components/sql/Sql'
import { Badge, Button, Spinner, cx } from '~/components/ui'

// `hero` is the large centered version on the overview; `onActiveChange` reports whether a
// question is running or answered, so the page can make room for the answer.
export function AskBox({ initial, hero = false, onActiveChange }: { initial?: string; hero?: boolean; onActiveChange?: (active: boolean) => void }) {
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

  const suggestions = (config?.golden ?? []).slice(0, hero ? 3 : 4).map((g) => g.question)
  const active = !!(res || busy || err)
  useEffect(() => onActiveChange?.(active), [active, onActiveChange])

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
    <div>
    <section className={cx('border bg-surface transition-[border-color,box-shadow]',
      hero ? 'rounded-xl shadow-[0_10px_40px_-12px_rgb(10_35_80/0.18)]' : 'rounded-lg',
      focused ? 'border-accent ring-3 ring-ring' : 'border-line')}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(q)
        }}
        className={cx('flex items-center gap-3', hero ? 'px-5' : 'px-4')}
      >
        <Sparkles className="size-4 shrink-0 text-accent" strokeWidth={1.75} />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={!ready}
          placeholder="Ask a question about your data"
          className={cx('flex-1 bg-transparent outline-none placeholder:text-faint', hero ? 'h-14 text-[15px]' : 'h-12 text-[14px]')}
        />
        {res && !busy && (
          <Button variant="ghost" size="sm" aria-label="Clear" icon={<X />} onClick={() => { setRes(null); setQ(''); setErr(null); input.current?.focus() }} />
        )}
        <Button type="submit" variant="primary" size="sm" aria-label="Ask" disabled={!ready || !q.trim()} loading={busy} icon={<ArrowUp />} />
      </form>

      {!hero && !active && suggestions.length > 0 && (
        // One quiet line of examples; it scrolls sideways instead of wrapping.
        <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-line px-4 py-2 [mask-image:linear-gradient(to_right,black_92%,transparent)] [scrollbar-width:none]">
          <span className="mr-1 shrink-0 text-[12px] text-faint">Try</span>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="h-6 shrink-0 rounded-md px-2 text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg"
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
              : res.source === 'agent' ? <Badge tone="accent"><Sparkles className="size-3" />Generated by the agent</Badge>
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
                <Button size="sm" className="ml-auto" icon={<BadgeCheck />} onClick={verify} title="Check the SQL before saving">
                  Save as verified
                </Button>
              )}
            </div>
          )}
          {showSql && res.sql && (
            <SqlBlock
              className="anim-fade mt-2"
              sql={res.sql}
              label={res.source === 'verified' ? 'Verified query' : <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-accent" />Generated query</span>}
              meta={res.source === 'verified' ? res.matched : 'Checked by the SQL guard before it ran'}
            />
          )}
        </div>
      )}
    </section>
    {hero && !active && suggestions.length > 0 && (
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {suggestions.map((sug) => (
          <button
            key={sug}
            onClick={() => submit(sug)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            {sug}
          </button>
        ))}
      </div>
    )}
    </div>
  )
}
