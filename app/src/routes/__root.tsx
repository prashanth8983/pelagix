import {
  HeadContent, Link, Outlet, Scripts, createRootRoute, redirect, useRouter, useRouterState, type ErrorComponentProps,
} from '@tanstack/react-router'
import { AlertTriangle, Compass } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppState } from '~/components/config/state'
import { Shell } from '~/components/Shell'
import { Toaster } from '~/components/Toaster'
import { Button } from '~/components/ui'
import { THEME_SCRIPT } from '~/lib/theme'
import { getSession } from '~/server/users'
import appCss from '~/styles.css?url'

const PUBLIC = ['/login']

export const Route = createRootRoute({
  // Every page needs a signed-in user. Accounts with a temporary password go to /account first.
  beforeLoad: async ({ location }) => {
    const session = await getSession()
    const path = location.pathname
    if (!session.user && !PUBLIC.includes(path)) {
      throw redirect({ to: '/login', search: { next: location.href } })
    }
    if (session.user?.must_change_password && path !== '/account' && !PUBLIC.includes(path)) {
      throw redirect({ to: '/account' })
    }
    return { session }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
      { title: 'Scorebase' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
    scripts: [{ children: THEME_SCRIPT }],
  }),
  component: Root,
  errorComponent: RootError,
  notFoundComponent: NotFound,
})

function Root() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <RootDocument>
      <Toaster>
        {PUBLIC.includes(path) ? (
          <Outlet />
        ) : (
          <AppState>
            <Shell>
              <Outlet />
            </Shell>
          </AppState>
        )}
      </Toaster>
    </RootDocument>
  )
}

function Centered({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-10 place-items-center rounded-lg border border-line bg-surface text-muted [&_svg]:size-5">{icon}</div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="mt-1.5 text-[13px] text-muted">{children}</div>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <Centered icon={<Compass />} title="Page not found">
      <p>That address doesn’t match any page.</p>
      <Link to="/" className="mt-4 inline-block font-medium text-accent hover:underline">Go to the overview</Link>
    </Centered>
  )
}

// Shown in place of a page that threw while rendering or loading. The message is shown,
// the stack is not.
function RootError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <RootDocument>
      <Centered icon={<AlertTriangle />} title="Something went wrong">
        <p className="break-words font-mono text-[12px]">{(error as Error).message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button onClick={() => { reset(); router.invalidate() }}>Try again</Button>
          <Button variant="ghost" onClick={() => router.history.push('/')}>Overview</Button>
        </div>
      </Centered>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
