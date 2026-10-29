import { createFileRoute, redirect } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, ErrorList, Field, Input, PageHeader, Select, Tabs } from '~/components/ui'
import { useMe } from '~/lib/session'
import { auditLog, createUser, deleteUser, listUsers, resetPassword, updateUser, type AdminUser } from '~/server/users'

export const Route = createFileRoute('/admin/users')({
  beforeLoad: ({ context }) => {
    if (context.session.user?.role !== 'admin') throw redirect({ to: '/' })
  },
  component: UsersPage,
})

type Role = AdminUser['role']
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : 'never')

function UsersPage() {
  const [tab, setTab] = useState<'users' | 'audit'>('users')
  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, and what they can change."
        actions={<Tabs value={tab} onChange={setTab} options={[{ value: 'users', label: 'Users' }, { value: 'audit', label: 'Audit log' }]} />}
      />
      {tab === 'users' ? <Users /> : <Audit />}
    </>
  )
}

function Users() {
  const { user: me } = useMe()
  const list = useServerFn(listUsers)
  const create = useServerFn(createUser)
  const update = useServerFn(updateUser)
  const reset = useServerFn(resetPassword)
  const del = useServerFn(deleteUser)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null)
  const [form, setForm] = useState({ email: '', name: '', role: 'viewer' as Role })

  const load = useCallback(() => list().then(setUsers).catch((e) => setErrors([(e as Error).message])), [list])
  useEffect(() => {
    load()
  }, [load])

  const act = async (fn: () => Promise<{ error: string | null }>) => {
    const r = await fn()
    setErrors(r.error ? [r.error] : [])
    load()
    return r
  }

  return (
    <div className="space-y-5">
      {errors.length > 0 && <ErrorList errors={errors} />}
      {secret && (
        <div className="rounded-lg border border-warning/25 bg-warning-subtle px-4 py-3 text-[13px] text-fg">
          <p>Temporary password for <span className="font-medium">{secret.email}</span>. Shown once. They’ll set their own at first sign-in.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-surface px-2 py-1 font-mono text-[13px]">{secret.password}</code>
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(secret.password)}>Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>Done</Button>
          </div>
        </div>
      )}

      <Card title="Add a user">
        <form
          className="grid items-end gap-3 md:grid-cols-[2fr_2fr_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await create({ data: form })
            setErrors(r.error ? [r.error] : [])
            if (!r.error) {
              if (r.password) setSecret({ email: form.email, password: r.password })
              setForm({ email: '', name: '', role: 'viewer' })
              load()
            }
          }}
        >
          <Field label="Email"><Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
            </Select>
          </Field>
          <Button type="submit" variant="primary">Add user</Button>
        </form>
      </Card>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-muted">
            <tr>
              <th className="px-5 py-2.5 font-medium">User</th>
              <th className="px-3 py-2.5 font-medium">Role</th>
              <th className="px-3 py-2.5 font-medium">Last sign-in</th>
              <th className="px-3 py-2.5 font-medium">Sessions</th>
              <th className="px-5 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me?.id
              return (
                <tr key={u.id} className={`border-t border-line/70 ${u.disabled ? 'opacity-60' : ''}`}>
                  <td className="px-5 py-2.5">
                    <p className="font-medium">{u.name || u.email} {self && <span className="font-normal text-muted">(you)</span>}</p>
                    <p className="text-[12px] text-muted">{u.email}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <Select className="!w-28" value={u.role} disabled={self}
                      onChange={(e) => act(() => update({ data: { id: u.id, role: e.target.value as Role } }))}>
                      <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option>
                    </Select>
                  </td>
                  <td className="px-3 py-2.5 text-muted">
                    {when(u.last_login_at)}
                    <div className="mt-0.5 flex gap-1">
                      {u.disabled && <Badge tone="danger">disabled</Badge>}
                      {u.must_change_password && <Badge tone="warning">temporary password</Badge>}
                    </div>
                  </td>
                  <td className="num px-3 py-2.5">{u.sessions}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={async () => {
                        const r = await act(() => reset({ data: { id: u.id } }))
                        const pw = (r as { password?: string | null }).password
                        if (pw) setSecret({ email: u.email, password: pw })
                      }}>Reset password</Button>
                      {!self && (
                        <Button size="sm" variant="ghost" onClick={() => act(() => update({ data: { id: u.id, disabled: !u.disabled } }))}>
                          {u.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      )}
                      {!self && <DeleteButton onConfirm={() => act(() => del({ data: { id: u.id } }))} />}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Two clicks instead of a browser confirm() dialog.
function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Button size="sm" variant="danger" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? 'Click to confirm' : 'Delete'}
    </Button>
  )
}

function Audit() {
  const fetchLog = useServerFn(auditLog)
  const [rows, setRows] = useState<Awaited<ReturnType<typeof auditLog>> | null>(null)
  useEffect(() => {
    fetchLog({ data: { limit: 200 } }).then(setRows).catch(() => setRows([]))
  }, [fetchLog])
  if (!rows) return <p className="text-sm text-muted">Loading…</p>
  const tone = (a: string) => (a.includes('failed') ? 'danger' : a.startsWith('user.') ? 'warning' : a.startsWith('config') || a.startsWith('run') ? 'accent' : 'neutral')
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[12px] text-muted">
          <tr><th className="px-5 py-2.5 font-medium">When</th><th className="px-3 py-2.5 font-medium">Who</th><th className="px-3 py-2.5 font-medium">Action</th><th className="px-3 py-2.5 font-medium">Detail</th><th className="px-5 py-2.5 font-medium">IP</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line/70">
              <td className="whitespace-nowrap px-5 py-2 text-muted">{new Date(r.at).toLocaleString()}</td>
              <td className="px-3 py-2">{r.email ?? '—'}</td>
              <td className="px-3 py-2"><Badge tone={tone(r.action) as 'neutral'}>{r.action}</Badge></td>
              <td className="px-3 py-2 font-mono text-[11px] text-muted">
                {Object.entries(r.detail).filter(([, v]) => v != null).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ')}
              </td>
              <td className="px-5 py-2 font-mono text-[11px] text-muted">{r.ip ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-5 py-6 text-sm text-muted">Nothing logged yet.</p>}
    </div>
  )
}
