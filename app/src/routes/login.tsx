import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Logo } from '~/components/layout/Shell'
import { Button, Callout, Field, Input } from '~/components/ui'
import { PROJECT } from '~/generated/project'
import { login, setupAdmin } from '~/server/users'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ next: z.string().optional() }),
  beforeLoad: ({ context }) => {
    if (context.session.user) throw redirect({ to: '/' })
  },
  component: Login,
})

// Only same-site paths, so ?next= can't send people elsewhere.
const safeNext = (n?: string) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/')

function Login() {
  const { session } = Route.useRouteContext()
  const { next } = Route.useSearch()
  const router = useRouter()
  const signIn = useServerFn(login)
  const setup = useServerFn(setupAdmin)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const first = session.needsSetup
  // Before hydration a submit would be a native form post; keep the button off until React runs.
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (first && password !== confirm) return setErr('Passwords don’t match')
    setBusy(true)
    setErr(null)
    try {
      const r = first ? await setup({ data: { email, name, password } }) : await signIn({ data: { email, password } })
      if (r.error) return setErr(r.error)
      await router.invalidate()
      router.history.push(safeNext(next))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel: fixed navy, the one place the brand color is used at full strength. */}
      <aside className="relative hidden overflow-hidden bg-[#0A2350] text-[#F4F7FB] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Waves />
        <div className="relative flex items-center gap-3">
          <Logo className="size-9" />
          <span className="text-[17px] font-semibold tracking-tight">Pelagi<span className="text-[#19D3E0]">x</span></span>
        </div>
        <p className="relative text-[12px] text-[#F4F7FB]/50">
          Project <span className="font-mono text-[#F4F7FB]/70">{PROJECT.name}</span> · {PROJECT.warehouse} warehouse
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="anim-rise w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo className="size-9" />
            <span className="text-[17px] font-semibold tracking-tight">Pelagi<span className="text-brand">x</span></span>
          </div>
          <h2 className="text-[22px] font-semibold tracking-tight">{first ? 'Create the admin account' : 'Sign in'}</h2>
          {first && <p className="mt-1.5 text-[13px] text-muted">This account gets admin access.</p>}
          <form method="post" onSubmit={submit} className="mt-8 space-y-5">
            {session.error && <Callout tone="danger">{session.error}</Callout>}
            {first && <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="h-10" /></Field>}
            <Field label="Email">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus className="h-10" />
            </Field>
            <Field label="Password" hint={first ? 'At least 10 characters' : undefined}>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={first ? 'new-password' : 'current-password'} className="h-10" />
            </Field>
            {first && (
              <Field label="Confirm password">
                <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className="h-10" />
              </Field>
            )}
            {err && <p className="text-[13px] text-danger" role="alert">{err}</p>}
            <Button type="submit" variant="primary" className="h-10 w-full text-[14px]" disabled={!ready || busy || !!session.error} loading={busy}>
              {first ? 'Create account' : 'Sign in'}
            </Button>
          </form>
          {!first && <p className="mt-6 text-[12px] text-faint">No account? Ask an admin to invite you.</p>}
        </div>
      </main>
    </div>
  )
}

/** The brand's two wave bands, drawn large and faint across the panel. */
function Waves() {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] w-full" viewBox="0 0 200 110" preserveAspectRatio="none">
      <path d="M0,40 C30,18 58,18 86,38 S142,58 200,30 V110 H0Z" fill="#12B5C9" opacity="0.18" />
      <path d="M0,62 C34,42 62,44 92,60 S150,78 200,54 V110 H0Z" fill="#0E5DB0" opacity="0.35" />
    </svg>
  )
}
