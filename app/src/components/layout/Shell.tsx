import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ChevronLeft, ChevronRight, ChevronsUpDown, LogOut, Menu, Monitor, Moon, Play, Search, Sun, UserRound } from 'lucide-react'
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { useMe } from '~/lib/session'
import { useTheme, type ThemePref } from '~/lib/theme'
import { logout } from '~/server/users'
import { CommandPalette } from '~/components/layout/CommandPalette'
import { useConfig, useRuns } from '~/components/config/state'
import { NAV, pageTitle } from '~/components/layout/nav'
import { useToast } from '~/components/ui/Toaster'
import { Button, Kbd, cx, useDismiss } from '~/components/ui'

const SIDEBAR_KEY = 'pelagix.sidebar'

// The Pelagix wave mark (docs/brand/pelagix-mark-wave.svg). Fixed brand colors: the navy
// disc reads on both the light and the dark theme.
export function Logo({ className = 'size-6' }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="16 16 168 168" className={className} role="img" aria-label="Pelagix">
      <defs><clipPath id={id}><circle cx="100" cy="100" r="84" /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect width="200" height="200" fill="#0A2350" />
        <path d="M0,118 C30,96 58,96 86,116 S142,136 200,108 V200 H0Z" fill="#12B5C9" />
        <path d="M0,140 C34,120 62,122 92,138 S150,156 200,132 V200 H0Z" fill="#0E5DB0" />
      </g>
      <g transform="rotate(-28 104 74)">
        <path d="M58,74 C74,52 116,50 136,74 C116,98 74,96 58,74Z" fill="#19D3E0" />
        <path d="M132,74 L160,54 L152,74 L160,94Z" fill="#19D3E0" />
        <circle cx="72" cy="70" r="4.5" fill="#fff" />
        <circle cx="73" cy="70" r="2.25" fill="#0A2350" />
      </g>
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

function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
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
        className={cx('flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-hover', open && 'bg-hover', collapsed && 'justify-center')}
        aria-expanded={open}
        aria-label={collapsed ? `Account menu for ${user.name || user.email}` : undefined}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-[#0E5DB0] text-[11px] font-semibold text-white shadow-sm ring-2 ring-surface">{initials}</span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium">{user.name || user.email}</span>
              <span className="block truncate text-[11px] capitalize text-faint">{user.role}</span>
            </span>
            <ChevronsUpDown className="size-3.5 text-faint" />
          </>
        )}
      </button>
      {open && (
        <div className={cx('anim-rise absolute bottom-full z-50 mb-1.5 rounded-lg border border-line bg-surface p-1 shadow-lg',
          collapsed ? 'left-0 w-56' : 'left-0 right-0')}>
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

const openPalette = () => window.dispatchEvent(new Event('scorebase:command'))

function Sidebar({ onNavigate, collapsed }: { onNavigate: () => void; collapsed: boolean }) {
  const { can } = useMe()
  const { latest } = useRuns()
  const { config } = useConfig()
  const running = latest?.status === 'running'
  const problems = config?.errors.length ?? 0
  // Live markers beside an item: a pulse while the pipeline runs, a count while the config has problems.
  const badge = (to: string): ReactNode => {
    if (to === '/runs' && running) return <span className="size-1.5 animate-pulse rounded-full bg-accent" title="Running" />
    if (to === '/configure/project' && problems > 0) {
      return collapsed ? <span className="size-1.5 rounded-full bg-danger" />
        : <span className="num rounded-full bg-danger-subtle px-1.5 text-[10.5px] font-semibold leading-4 text-danger">{problems}</span>
    }
    return null
  }
  return (
    <div className="flex h-full flex-col">
      <div className={cx('flex h-16 shrink-0 items-center gap-3', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Logo className={cx('shrink-0 drop-shadow-[0_2px_5px_rgb(10_35_80/0.28)]', collapsed ? 'size-8' : 'size-9')} />
        {!collapsed && <p className="text-[16px] font-semibold tracking-tight">Pelagi<span className="text-brand">x</span></p>}
      </div>
      <div className={cx('h-px shrink-0 bg-gradient-to-r from-transparent via-line to-transparent', collapsed ? 'mx-2' : 'mx-5')} />

      {/* Collapsed, the rail is short enough not to scroll, so labels can pop out to the side. */}
      <nav className={cx('flex-1 py-5', collapsed ? 'space-y-4 overflow-visible px-2.5' : 'space-y-6 overflow-y-auto px-4')}>
        {NAV.filter((g) => can(g.role)).map((g, gi) => (
          <div key={g.group}>
            {collapsed
              ? gi > 0 && <div className="mx-2 mb-4 border-t border-line" />
              : <p className="mb-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-faint">{g.group}</p>}
            <div className="space-y-1">
              {g.items.map((i) => (
                <Link
                  key={i.to}
                  to={i.to}
                  onClick={onNavigate}
                  aria-label={collapsed ? i.label : undefined}
                  activeOptions={{ exact: i.to === '/' || i.to === '/configure' }}
                  className={cx('group/n relative flex h-9 items-center gap-3 rounded-xl text-[13.5px] text-muted transition-[background-color,color,box-shadow] duration-150 hover:bg-hover hover:text-fg',
                    collapsed ? 'justify-center px-0' : 'px-3')}
                  activeProps={{ className: '!bg-accent-subtle !text-fg font-medium shadow-nav' }}
                >
                  {/* The active page gets a short brand bar on the pill's left edge. */}
                  <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 scale-y-50 rounded-r-full bg-gradient-to-b from-brand to-accent opacity-0 transition-[opacity,transform] duration-200 group-data-[status=active]/n:scale-y-100 group-data-[status=active]/n:opacity-100" />
                  <i.icon className="size-4 shrink-0 text-faint transition-colors group-hover/n:text-muted group-data-[status=active]/n:text-brand" strokeWidth={1.75} />
                  {collapsed ? (
                    <>
                      {badge(i.to) && <span className="absolute right-1.5 top-1.5 flex">{badge(i.to)}</span>}
                      <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-primary px-2 py-1 text-[12px] font-medium text-primary-fg opacity-0 shadow-md transition-opacity group-hover/n:opacity-100 group-focus-visible/n:opacity-100">
                        {i.label}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{i.label}</span>
                      {badge(i.to)}
                    </>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className={cx('shrink-0', collapsed ? 'p-2.5' : 'p-4')}>
        <div className={cx('rounded-xl border border-line bg-subtle/60', collapsed ? 'p-0.5' : 'p-1')}><UserMenu collapsed={collapsed} /></div>
      </div>
    </div>
  )
}

function Breadcrumb() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const t = pageTitle(path)
  const Icon = NAV.flatMap((g) => g.items).filter((i) => i.to === '/' ? path === '/' : path.startsWith(i.to)).sort((a, b) => b.to.length - a.to.length)[0]?.icon
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
      {t.group && <><span className="text-faint">{t.group}</span><ChevronRight className="size-3.5 text-faint" /></>}
      {Icon && <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-surface text-brand shadow-sm"><Icon className="size-3.5" strokeWidth={1.75} /></span>}
      <span className="truncate font-medium">{t.label}</span>
    </div>
  )
}

const FULL_BLEED = ['/explore']

/** Each page enters with a short fade and lift; the key restarts it on navigation. */
function PageTransition({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    // Workbench pages use the full width and height; everything else reads in a centred column.
    <main key={path} className={cx('anim-page mx-auto px-4 sm:px-6', FULL_BLEED.some((p) => path.startsWith(p)) ? 'max-w-none py-4 sm:px-5' : 'max-w-[1200px] py-8')}>
      {children}
    </main>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { error, config } = useConfig()
  const { can } = useMe()
  const [open, setOpen] = useState(false)
  // Desktop sidebar: full or an icon rail. Remembered per browser; ⌘B / Ctrl+B toggles it.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === 'collapsed')
    } catch {}
  }, [])
  const toggle = useCallback(() => setCollapsed((c) => {
    try {
      localStorage.setItem(SIDEBAR_KEY, c ? 'expanded' : 'collapsed')
    } catch {}
    return !c
  }), [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() === 'b' && (e.metaKey || e.ctrlKey) && !t.closest('input, textarea, [contenteditable]')) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [toggle])
  const problems = config?.errors.length ?? 0
  // The header lifts off the page once content scrolls under it.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  // Marks the page interactive; browser tests wait for it before clicking.
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])

  return (
    // --sidebar-w is read by fixed elements (save bars) that center themselves on the content.
    <div className="min-h-screen" style={{ ['--sidebar-w' as string]: collapsed ? '5.75rem' : '17.5rem' }}>
      <aside className={cx(
        // Phones: a full-height drawer. Desktop: a floating panel inset from the window edges.
        'fixed inset-y-0 left-0 z-40 w-64 bg-surface shadow-side transition-[transform,width] duration-200 lg:inset-y-3 lg:left-3 lg:translate-x-0 lg:rounded-2xl lg:border lg:border-line lg:shadow-lg',
        collapsed && 'lg:w-[4.25rem]',
        open ? 'translate-x-0' : '-translate-x-full',
      )}>
        {/* On small screens the sidebar is a drawer and always shows labels. */}
        <div className="h-full lg:hidden"><Sidebar onNavigate={() => setOpen(false)} collapsed={false} /></div>
        <div className="hidden h-full lg:block"><Sidebar onNavigate={() => setOpen(false)} collapsed={collapsed} /></div>
        {/* Sits on the border between the sidebar and the page, level with the header. */}
        <button
          onClick={toggle}
          title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (⌘B)`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute -right-3 top-5 hidden size-6 place-items-center rounded-full border border-line bg-surface text-muted shadow-md transition-[color,border-color,transform] hover:scale-110 hover:border-line-strong hover:text-fg lg:grid"
        >
          {collapsed ? <ChevronRight className="size-3.5" strokeWidth={2} /> : <ChevronLeft className="size-3.5" strokeWidth={2} />}
        </button>
      </aside>
      {open && <div className="anim-fade fixed inset-0 z-30 bg-overlay lg:hidden" onClick={() => setOpen(false)} />}

      <div className={cx('transition-[padding] duration-200', collapsed ? 'lg:pl-[5.75rem]' : 'lg:pl-[17.5rem]')}>
        <header className={cx('sticky top-0 z-20 flex h-14 items-center justify-between gap-3 bg-canvas/80 px-4 backdrop-blur-md backdrop-saturate-150 transition-shadow duration-200 sm:px-6',
          scrolled ? 'shadow-header-scrolled' : 'shadow-header')}>
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
            <button onClick={openPalette}
              className="hidden h-8 w-56 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-faint shadow-sm transition-colors hover:border-line-strong hover:text-muted md:flex">
              <Search className="size-3.5" />
              <span className="flex-1 text-left">Search or ask…</span>
              <Kbd>⌘K</Kbd>
            </button>
            {can('editor') && <><RunStatus /><RunButton /></>}
          </div>
        </header>
        <PageTransition>{children}</PageTransition>
      </div>
      <CommandPalette />
    </div>
  )
}
