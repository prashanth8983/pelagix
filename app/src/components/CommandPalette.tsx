// ⌘K: jump to any page, run the pipeline, switch theme, or send a question to the Ask box.
import { useNavigate } from '@tanstack/react-router'
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTheme } from '~/lib/theme'
import { useMe } from '~/lib/session'
import { useRuns } from './config/state'
import { NAV } from './nav'
import { useToast } from './Toaster'
import { Kbd, cx } from './ui'

type Command = { id: string; label: string; group: string; icon?: ReactNode; hint?: string; run: () => void }

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const { can } = useMe()
  const { start } = useRuns()
  const toast = useToast()
  const [, setTheme] = useTheme()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const openEvt = () => setOpen(true)
    window.addEventListener('keydown', key)
    window.addEventListener('scorebase:command', openEvt)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('scorebase:command', openEvt)
    }
  }, [])
  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      setTimeout(() => input.current?.focus(), 0)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const pages = NAV.filter((g) => can(g.role)).flatMap((g) =>
      g.items.map((i) => ({ id: i.to, label: i.label, group: 'Go to', icon: <i.icon className="size-4" />, run: () => navigate({ to: i.to }) })))
    const actions: Command[] = [
      ...(can('editor') ? [{
        id: 'run', label: 'Run pipeline', group: 'Actions', run: async () => {
          const errs = await start()
          toast(errs ? { title: 'Run not started', description: errs.join('; '), tone: 'danger' } : { title: 'Pipeline run started', tone: 'success' })
        },
      }] : []),
      { id: 'account', label: 'Account settings', group: 'Actions', run: () => navigate({ to: '/account' }) },
      { id: 'light', label: 'Use light theme', group: 'Theme', run: () => setTheme('light') },
      { id: 'dark', label: 'Use dark theme', group: 'Theme', run: () => setTheme('dark') },
      { id: 'system', label: 'Follow system theme', group: 'Theme', run: () => setTheme('system') },
    ]
    return [...pages, ...actions]
  }, [can, navigate, start, toast, setTheme])

  const term = q.trim().toLowerCase()
  const shown = term ? commands.filter((c) => c.label.toLowerCase().includes(term)) : commands
  const ask: Command | null = term.length > 2
    ? { id: 'ask', label: `Ask “${q.trim()}”`, group: 'Ask', hint: 'Overview', run: () => navigate({ to: '/', search: { q: q.trim() } }) }
    : null
  const list = ask ? [...shown, ask] : shown

  if (!open) return null
  const choose = (c?: Command) => {
    if (!c) return
    setOpen(false)
    c.run()
  }
  let lastGroup = ''
  return (
    <div className="anim-fade fixed inset-0 z-50 bg-overlay" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Command menu"
        onMouseDown={(e) => e.stopPropagation()}
        className="anim-rise mx-auto mt-[12vh] w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="size-4 text-faint" />
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); choose(list[active]) }
              if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Search pages and actions, or type a question…"
            className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {list.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted">No matches</p>}
          {list.map((c, i) => {
            const header = c.group !== lastGroup ? (lastGroup = c.group) : null
            return (
              <div key={c.id}>
                {header && <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-faint">{header}</p>}
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={cx('flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px]', i === active ? 'bg-hover text-fg' : 'text-muted')}
                >
                  <span className="text-faint">{c.icon}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  {i === active && <CornerDownLeft className="size-3.5 text-faint" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
