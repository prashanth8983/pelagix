import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ChevronRight, ChevronsUpDown, LogOut, Menu, Monitor, Moon, Play, Search, Sun, UserRound } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { PROJECT } from '~/generated/project'
import { useMe } from '~/lib/session'
import { useTheme, type ThemePref } from '~/lib/theme'
import { logout } from '~/server/users'
import { CommandPalette } from './CommandPalette'
import { useConfig, useRuns } from './config/state'
import { NAV, pageTitle } from './nav'
import { useToast } from './Toaster'
import { Button, Kbd, cx, useDismiss } from './ui'

export function Logo({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect width="24" height="24" rx="6" className="fill-primary" />
      <path d="M7 15.5h3M7 12h6.5M7 8.5h10" className="stroke-primary-fg" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function RunButton() {
  const { latest, start } = useRuns()
  const toast = useToast()
  const running = latest?.status === 'running'
  const current = running ? latest.steps.at(-1)?.step : null
  return (
    <Button
      variant="primary"
      disabled={running}
      icon={running ? undefined : <Play />}
      loading={running}
      onClick={async () => {
        const errs = await start()
        toast(errs
          ? { title: 'Run not started', description: errs.join('; '), tone: 'danger' }
          : { title: 'Pipeline run started', description: 'Follow it on the runs page.', tone: 'success' })
      }}
    >
      {running ? `Running · ${current ?? 'starting'}` : 'Run pipeline'}
    </Button>
  )
}

function RunStatus() {
  const { latest } = useRuns()
  if (!latest || latest.status === 'running') return null
  const ok = latest.status === 'ok'
  return (
    <Link to="/runs" className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg md:flex">
      <span className={cx('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-danger')} />
      Last run {ok ? 'succeeded' : 'failed'}
    </Link>
  )
}

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

function UserMenu() {
  const { user } = useMe()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useTheme()
  const router = useRouter()
  const signOut = useServerFn(logout)
  const ref = useDismiss(open, () => setOpen(false))
  if (!user) return null
  const initials = (user.name || user.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left hover:bg-hover"
        aria-expanded={open}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-subtle text-[11px] font-semibold text-muted ring-1 ring-line">{initials}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-medium">{user.name || user.email}</span>
          <span className="block truncate text-[11px] capitalize text-faint">{user.role}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-faint" />
      </button>
      {open && (
        <div className="anim-rise absolute bottom-full left-0 right-0 mb-1.5 rounded-lg border border-line bg-surface p-1 shadow-lg shadow-black/5">
          <p className="truncate px-2 pb-1.5 pt-1 text-[12px] text-muted">{user.email}</p>
          <Link to="/account" onClick={() => setOpen(false)} className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover">
            <UserRound className="size-4 text-muted" /> Account
          </Link>
          <div className="my-1 border-t border-line" />
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[13px]">Theme</span>
            <div className="flex rounded-md bg-subtle p-0.5">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  title={t.label}
                  aria-label={`${t.label} theme`}
                  onClick={() => setTheme(t.value)}
                  className={cx('grid size-6 place-items-center rounded', theme === t.value ? 'bg-surface text-fg shadow-sm' : 'text-faint hover:text-fg')}
                >
                  <t.icon className="size-3.5" />
                </button>
              ))}
            </div>
          </div>
          <div className="my-1 border-t border-line" />
          <button
            onClick={async () => { await signOut(); await router.invalidate(); router.history.push('/login') }}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-hover"
          >
            <LogOut className="size-4 text-muted" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { can } = useMe()
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <div className="min-w-0 leading-tight">
          <p className="text-[13px] font-semibold">Scorebase</p>
          <p className="truncate text-[11px] text-faint">{PROJECT.name} · {PROJECT.warehouse}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-3">
        {NAV.filter((g) => can(g.role)).map((g) => (
          <div key={g.group}>
            <p className="mb-1 px-2 text-[11px] font-medium text-faint">{g.group}</p>
            <div className="space-y-px">
              {g.items.map((i) => (
                <Link
                  key={i.to}
                  to={i.to}
                  onClick={onNavigate}
                  activeOptions={{ exact: i.to === '/' }}
                  className="group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg"
                  activeProps={{ className: '!bg-hover !text-fg font-medium' }}
                >
                  <i.icon className="size-4 shrink-0 opacity-80" strokeWidth={1.75} />
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-2.5">
        <UserMenu />
      </div>
    </div>
  )
}

function Breadcrumb() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const t = pageTitle(path)
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {t.group && <><span className="text-faint">{t.group}</span><ChevronRight className="size-3.5 text-faint" /></>}
      <span className="truncate font-medium">{t.label}</span>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { error, config } = useConfig()
  const { can } = useMe()
  const [open, setOpen] = useState(false)
  const problems = config?.errors.length ?? 0
  // Marks the page interactive; browser tests wait for it before clicking.
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])

  return (
    <div className="min-h-screen">
      <aside className={cx(
        'fixed inset-y-0 left-0 z-40 w-60 border-r border-line bg-canvas transition-transform lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}>
        <Sidebar onNavigate={() => setOpen(false)} />
      </aside>
      {open && <div className="anim-fade fixed inset-0 z-30 bg-overlay lg:hidden" onClick={() => setOpen(false)} />}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" className="lg:hidden" aria-label="Open menu" icon={<Menu />} onClick={() => setOpen(true)} />
            <Breadcrumb />
          </div>
          <div className="flex items-center gap-2">
            {error && <span className="hidden text-[12px] text-danger md:inline">Engine API unreachable</span>}
            {!error && problems > 0 && can('editor') && (
              <Link to="/configure/project" className="hidden items-center gap-1.5 text-[12px] text-danger md:flex">
                <span className="size-1.5 rounded-full bg-danger" />{problems} config problem{problems > 1 ? 's' : ''}
              </Link>
            )}
            <button
              onClick={() => window.dispatchEvent(new Event('scorebase:command'))}
              className="hidden h-8 w-56 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-faint transition-colors hover:border-line-strong md:flex"
            >
              <Search className="size-3.5" />
              <span className="flex-1 text-left">Search or ask…</span>
              <Kbd>⌘K</Kbd>
            </button>
            {can('editor') && <><RunStatus /><RunButton /></>}
          </div>
        </header>
        <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  )
}
