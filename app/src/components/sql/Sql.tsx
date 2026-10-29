// SQL display and editing: syntax highlighting, line numbers, copy, and an editor that
// highlights as you type (a transparent textarea over the highlighted text).
import { Link } from '@tanstack/react-router'
import { Check, Copy, SquareArrowOutUpRight } from 'lucide-react'
import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Button, cx } from '~/components/ui'

const KEYWORDS = new Set(`
  select from where and or not in is null as on join left right inner outer full cross group by order having limit offset
  union all intersect except distinct with case when then else end between like ilike asc desc nulls first last over
  partition rows range preceding following current row filter within qualify window true false using lateral exists any
  cast interval date timestamp
`.trim().split(/\s+/))

type Tok = { t: 'kw' | 'fn' | 'str' | 'num' | 'cmt' | 'plain'; v: string }
const TOKEN = /(--[^\n]*)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+|[^\sA-Za-z0-9_'"-]+|-)/g

export function tokenize(sql: string): Tok[] {
  const out: Tok[] = []
  for (const m of sql.matchAll(TOKEN)) {
    const [v, cmt, str, quoted, num, word] = m
    if (cmt) out.push({ t: 'cmt', v })
    else if (str) out.push({ t: 'str', v })
    else if (quoted) out.push({ t: 'plain', v })
    else if (num) out.push({ t: 'num', v })
    else if (word) {
      const next = sql.slice((m.index ?? 0) + v.length).match(/^\s*\(/)
      out.push({ t: KEYWORDS.has(v.toLowerCase()) ? 'kw' : next ? 'fn' : 'plain', v })
    } else out.push({ t: 'plain', v })
  }
  return out
}

function Highlighted({ sql }: { sql: string }) {
  return (
    <>
      {tokenize(sql).map((k, i) =>
        k.t === 'plain' ? <Fragment key={i}>{k.v}</Fragment> : <span key={i} className={`tok-${k.t}`}>{k.v}</span>,
      )}
    </>
  )
}

const mono = 'font-mono text-[12.5px] leading-[20px]'

function Gutter({ lines }: { lines: number }) {
  return (
    <div aria-hidden className={cx(mono, 'select-none border-r border-line px-3 py-3 text-right text-[var(--code-gutter)]')}>
      {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={done ? <Check /> : <Copy />}
      onClick={async () => {
        await navigator.clipboard?.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  )
}

/** Read-only SQL with a header: a label, optional details, copy and open-in-workspace. */
export function SqlBlock({ sql, label = 'SQL', meta, openInWorkspace = true, maxHeight = 360, className }:
  { sql: string; label?: ReactNode; meta?: ReactNode; openInWorkspace?: boolean; maxHeight?: number; className?: string }) {
  const lines = sql.split('\n').length
  return (
    <div className={cx('overflow-hidden rounded-lg border border-line bg-subtle', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className="font-medium">{label}</span>
          {meta && <span className="truncate text-faint">{meta}</span>}
        </div>
        <div className="flex shrink-0 items-center">
          <CopyButton text={sql} />
          {openInWorkspace && (
            <Link to="/explore" search={{ sql }} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-hover hover:text-fg">
              <SquareArrowOutUpRight className="size-4" /> Open in workspace
            </Link>
          )}
        </div>
      </div>
      <div className="flex overflow-auto" style={{ maxHeight }}>
        <Gutter lines={lines} />
        <pre className={cx(mono, 'flex-1 px-4 py-3 text-fg')}><code><Highlighted sql={sql} /></code></pre>
      </div>
    </div>
  )
}

/** Editable SQL with live highlighting and line numbers. Tab indents; ⌘/Ctrl+Enter calls onRun. */
export function SqlEditor({ value, onChange, onRun, minRows = 8, className, ariaLabel = 'SQL', inputRef, fill }:
  {
    value: string; onChange: (v: string) => void; onRun?: () => void; minRows?: number; className?: string; ariaLabel?: string
    /** The underlying textarea, for callers that read the selection or insert at the cursor. */
    inputRef?: RefObject<HTMLTextAreaElement | null>
    /** Grow to the parent's height instead of capping at 20 lines. */
    fill?: boolean
  }) {
  const own = useRef<HTMLTextAreaElement>(null)
  const area = inputRef ?? own
  const layer = useRef<HTMLPreElement>(null)
  const lines = Math.max(value.split('\n').length, minRows)

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onRun) {
      e.preventDefault()
      onRun()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const t = e.currentTarget
      const { selectionStart: a, selectionEnd: b } = t
      onChange(value.slice(0, a) + '  ' + value.slice(b))
      requestAnimationFrame(() => t.setSelectionRange(a + 2, a + 2))
    }
  }
  // The textarea scrolls sideways on its own; keep the highlighted layer under it in step.
  const sync = () => {
    if (area.current && layer.current) layer.current.scrollLeft = area.current.scrollLeft
  }

  return (
    // One vertical scroller holds the gutter and the text, so line numbers never drift.
    <div className={cx('overflow-y-auto rounded-lg border border-line bg-subtle transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-ring', className)}
      style={fill ? undefined : { maxHeight: 24 * 20 + 24 }}>
      <div className="flex min-h-full">
      <Gutter lines={lines} />
      <div className="relative min-w-0 flex-1">
        <pre ref={layer} aria-hidden className={cx(mono, 'pointer-events-none overflow-hidden whitespace-pre px-4 py-3 text-fg')}>
          <code><Highlighted sql={value} />{'\n'.repeat(Math.max(1, minRows - value.split('\n').length + 1))}</code>
        </pre>
        <textarea
          ref={area}
          aria-label={ariaLabel}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={keyDown}
          onScroll={sync}
          wrap="off"
          className={cx(mono, 'absolute inset-0 resize-none overflow-x-auto overflow-y-hidden whitespace-pre bg-transparent px-4 py-3 text-transparent caret-[var(--fg)] outline-none selection:bg-[var(--ring)] selection:text-transparent')}
        />
      </div>
      </div>
    </div>
  )
}
