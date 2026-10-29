import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Logo } from '~/components/Shell'
import { Button, Callout, Field, Input } from '~/components/ui'
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
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo className="size-9" />
          <div className="text-center">
            <p className="text-[15px] font-semibold tracking-tight">Scorebase</p>
            <p className="text-[13px] text-muted">{first ? 'Set up your workspace' : 'Sign in to your workspace'}</p>
          </div>
        </div>
        <form method="post" onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-[0_1px_3px_rgb(0_0_0/0.04)]">
          {first && (
            <div>
              <h1 className="text-[15px] font-semibold">Create the admin account</h1>
              <p className="mt-1 text-[13px] text-muted">The first account is an admin and can invite everyone else.</p>
            </div>
          )}
          {session.error && <Callout tone="danger">{session.error}</Callout>}
          {first && <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus /></Field>
          <Field label="Password" hint={first ? 'At least 10 characters' : undefined}>
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={first ? 'new-password' : 'current-password'} />
          </Field>
          {first && <Field label="Confirm password"><Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>}
          {err && <p className="text-[13px] text-danger">{err}</p>}
          <Button type="submit" variant="primary" className="w-full" disabled={!ready || busy || !!session.error}>
            {busy ? 'One moment…' : first ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        {!first && <p className="mt-6 text-center text-[12px] text-faint">No account? Ask an admin to invite you.</p>}
      </div>
    </div>
  )
}
