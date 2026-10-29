import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Laptop, LogOut } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ago } from '~/components/format'
import { useToast } from '~/components/Toaster'
import { Badge, Button, Callout, Card, ConfirmButton, Field, Input, PageHeader, Skeleton } from '~/components/ui'
import { useMe } from '~/lib/session'
import { changePassword, logout, mySessions, revokeSessions, type SessionInfo } from '~/server/users'

export const Route = createFileRoute('/account')({ component: Account })

const ROLE_HELP = {
  viewer: 'Read data, ask questions and run SQL.',
  editor: 'Everything a viewer can, plus change configuration and run the pipeline.',
  admin: 'Everything an editor can, plus manage users and read the audit log.',
}

// A readable device name from a user agent, without a parsing library.
function device(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

function Account() {
  const { user } = useMe()
  const router = useRouter()
  const toast = useToast()
  const change = useServerFn(changePassword)
  const signOut = useServerFn(logout)
  const listSessions = useServerFn(mySessions)
  const revoke = useServerFn(revokeSessions)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)

  const load = useCallback(() => listSessions().then(setSessions).catch(() => setSessions([])), [listSessions])
  useEffect(() => {
    load()
  }, [load])
  if (!user) return null

  return (
    <>
      <PageHeader title="Account" description={user.email} actions={
        <Button icon={<LogOut />} onClick={async () => { await signOut(); await router.invalidate(); router.history.push('/login') }}>Sign out</Button>
      } />
      {user.must_change_password && (
        <Callout tone="warning" title="Choose your own password" className="mb-6">An admin set your current password. Change it to continue.</Callout>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card title="Profile">
            <dl className="divide-y divide-line text-[13px]">
              <div className="flex justify-between py-2 first:pt-0"><dt className="text-muted">Name</dt><dd>{user.name || '—'}</dd></div>
              <div className="flex justify-between py-2"><dt className="text-muted">Email</dt><dd>{user.email}</dd></div>
              <div className="flex items-center justify-between py-2 last:pb-0"><dt className="text-muted">Role</dt><dd><Badge tone="accent" className="capitalize">{user.role}</Badge></dd></div>
            </dl>
            <p className="mt-3 text-[12px] text-faint">{ROLE_HELP[user.role]}</p>
          </Card>

          <Card
            title="Sessions"
            description="Browsers signed in to your account"
            actions={sessions && sessions.length > 1 && (
              <ConfirmButton size="sm" confirmLabel="Sign out others?" onConfirm={async () => {
                const r = await revoke({ data: { others: true } })
                toast({ title: `Signed out ${r.revoked} other session${r.revoked === 1 ? '' : 's'}`, tone: 'success' })
                load()
              }}>Sign out others</ConfirmButton>
            )}
            padded={false}
          >
            {!sessions ? <div className="p-4"><Skeleton className="h-16" /></div> : (
              <ul className="divide-y divide-line">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <Laptop className="size-4 shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[13px]">
                        {device(s.user_agent)} {s.current && <Badge tone="success">This browser</Badge>}
                      </p>
                      <p className="text-[12px] text-faint">{s.ip ?? 'unknown address'} · active {ago(new Date(s.last_seen_at).getTime())}</p>
                    </div>
                    {!s.current && (
                      <Button size="sm" variant="ghost" onClick={async () => { await revoke({ data: { id: s.id } }); load() }}>Sign out</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card title="Password" description="Changing it signs you out everywhere else">
          <form
            method="post"
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (next !== confirm) return setErr('New passwords don’t match')
              setBusy(true)
              try {
                const r = await change({ data: { current, next } })
                if (r.error) return setErr(r.error)
                setErr(null)
                setCurrent(''); setNext(''); setConfirm('')
                toast({ title: 'Password changed', description: 'Other sessions were signed out.', tone: 'success' })
                await router.invalidate()
                load()
              } finally {
                setBusy(false)
              }
            }}
          >
            <Field label="Current password"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
            <Field label="New password" hint="At least 10 characters"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
            <Field label="Confirm new password"><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></Field>
            {err && <p className="text-[13px] text-danger">{err}</p>}
            <Button type="submit" variant="primary" loading={busy} disabled={!current || !next}>Change password</Button>
          </form>
        </Card>
      </div>
    </>
  )
}
