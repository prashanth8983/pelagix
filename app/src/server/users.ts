// Sign-in, account and user-administration server functions.
// The first visitor to a fresh install creates the first admin; after that, only admins add users.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Json } from '~/lib/types'

const auth = () => import('./auth')
const email = z.string().trim().toLowerCase().email().max(200)
const role = z.enum(['viewer', 'editor', 'admin'])

export type PublicUser = { id: string; email: string; name: string; role: 'viewer' | 'editor' | 'admin'; must_change_password?: boolean }
const pub = (u: PublicUser): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, must_change_password: u.must_change_password })

export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const a = await auth()
  try {
    const user = await a.currentUser()
    return { user: user ? pub(user) : null, needsSetup: user ? false : (await a.countUsers()) === 0, error: null as string | null }
  } catch (e) {
    return { user: null, needsSetup: false, error: (e as Error).message }
  }
})

export const setupAdmin = createServerFn({ method: 'POST' })
  .validator(z.object({ email, name: z.string().trim().max(100), password: z.string() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const bad = a.checkPassword(data.password)
    if (bad) return { error: bad }
    const pool = await a.ready()
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT pg_advisory_xact_lock(hashtext('scorebase_setup'))") // two tabs can't both win
      const { rows: [{ n }] } = await c.query('SELECT COUNT(*)::int AS n FROM scorebase_auth.users')
      if (n > 0) {
        await c.query('ROLLBACK')
        return { error: 'Setup is already done. Sign in instead.' }
      }
      const { rows: [u] } = await c.query(
        `INSERT INTO scorebase_auth.users (email, name, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id, email`,
        [data.email, data.name, await a.hashPassword(data.password)],
      )
      await c.query('COMMIT')
      await a.startSession(u.id)
      await a.audit(u, 'setup')
      return { error: null }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  })

export const login = createServerFn({ method: 'POST' })
  .validator(z.object({ email, password: z.string().max(200) }))
  .handler(async ({ data }) => {
    const a = await auth()
    if (a.lockedOut(data.email)) return { error: 'Too many failed attempts. Try again in 15 minutes.' }
    const pool = await a.ready()
    const { rows: [u] } = await pool.query(
      'SELECT id, email, password_hash, disabled FROM scorebase_auth.users WHERE lower(email) = $1', [data.email])
    // Same work and the same message whether or not the email exists.
    const ok = u ? await a.verifyPassword(data.password, u.password_hash) : (await a.hashPassword(data.password), false)
    if (!ok || u.disabled) {
      a.noteFailure(data.email)
      await a.audit(u ?? null, 'login_failed', { email: data.email, reason: u?.disabled ? 'disabled' : 'bad credentials' })
      return { error: 'Wrong email or password' }
    }
    a.clearFailures(data.email)
    await a.startSession(u.id)
    await a.audit(u, 'login')
    return { error: null }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  const a = await auth()
  const u = await a.currentUser()
  await a.endSession()
  if (u) await a.audit(u, 'logout')
  return { ok: true }
})

export const changePassword = createServerFn({ method: 'POST' })
  .validator(z.object({ current: z.string().max(200), next: z.string() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser()
    const bad = a.checkPassword(data.next)
    if (bad) return { error: bad }
    const pool = await a.ready()
    const { rows: [u] } = await pool.query('SELECT password_hash FROM scorebase_auth.users WHERE id = $1', [me.id])
    if (!(await a.verifyPassword(data.current, u.password_hash))) return { error: 'Current password is wrong' }
    await pool.query('UPDATE scorebase_auth.users SET password_hash = $2, must_change_password = false WHERE id = $1',
      [me.id, await a.hashPassword(data.next)])
    await pool.query('DELETE FROM scorebase_auth.sessions WHERE user_id = $1', [me.id]) // sign out everywhere else
    await a.startSession(me.id)
    await a.audit(me, 'password.change')
    return { error: null }
  })

// ---------- your sessions ----------

export type SessionInfo = { id: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null; current: boolean }

export const mySessions = createServerFn({ method: 'GET' }).handler(async () => {
  const a = await auth()
  const me = await a.requireUser()
  const current = await a.currentTokenHash()
  const { rows } = await (await a.ready()).query(
    `SELECT token_hash, created_at, last_seen_at, ip, user_agent FROM scorebase_auth.sessions
     WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`, [me.id])
  // Sessions are identified by a prefix of the token's hash; the hash itself never leaves the server.
  return rows.map((r) => ({
    id: (r.token_hash as string).slice(0, 16), created_at: r.created_at, last_seen_at: r.last_seen_at,
    ip: r.ip, user_agent: r.user_agent, current: r.token_hash === current,
  })) as SessionInfo[]
})

export const revokeSessions = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().regex(/^[0-9a-f]{16}$/).optional(), others: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser()
    const current = (await a.currentTokenHash()) ?? ''
    const pool = await a.ready()
    const { rowCount } = data.others
      ? await pool.query('DELETE FROM scorebase_auth.sessions WHERE user_id = $1 AND token_hash <> $2', [me.id, current])
      : await pool.query('DELETE FROM scorebase_auth.sessions WHERE user_id = $1 AND token_hash LIKE $2 AND token_hash <> $3',
        [me.id, `${data.id}%`, current])
    await a.audit(me, 'session.revoke', { count: rowCount ?? 0, others: !!data.others })
    return { revoked: rowCount ?? 0 }
  })

// ---------- admin ----------

export type AdminUser = PublicUser & { disabled: boolean; created_at: string; last_login_at: string | null; sessions: number }

export const listUsers = createServerFn({ method: 'GET' }).handler(async () => {
  const a = await auth()
  await a.requireUser('admin')
  const { rows } = await (await a.ready()).query(
    `SELECT u.id, u.email, u.name, u.role, u.disabled, u.must_change_password, u.created_at, u.last_login_at,
            (SELECT COUNT(*)::int FROM scorebase_auth.sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
     FROM scorebase_auth.users u ORDER BY u.created_at`)
  return rows as AdminUser[]
})

export const createUser = createServerFn({ method: 'POST' })
  .validator(z.object({ email, name: z.string().trim().max(100), role, password: z.string().optional() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser('admin')
    const password = data.password || a.tempPassword()
    const bad = a.checkPassword(password)
    if (bad) return { error: bad, password: null }
    const pool = await a.ready()
    try {
      const { rows: [u] } = await pool.query(
        `INSERT INTO scorebase_auth.users (email, name, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [data.email, data.name, await a.hashPassword(password), data.role])
      await a.audit(me, 'user.create', { target: data.email, role: data.role })
      return { error: null, password: data.password ? null : password, id: u.id as string }
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return { error: 'A user with that email already exists', password: null }
      throw e
    }
  })

export const updateUser = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid(), role: role.optional(), disabled: z.boolean().optional(), name: z.string().trim().max(100).optional() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser('admin')
    const pool = await a.ready()
    const { rows: [target] } = await pool.query('SELECT id, email, role, disabled FROM scorebase_auth.users WHERE id = $1', [data.id])
    if (!target) return { error: 'No such user' }
    const losesAdmin = target.role === 'admin' && !target.disabled && ((data.role && data.role !== 'admin') || data.disabled)
    if (losesAdmin && (await a.otherActiveAdmins(target.id)) === 0) return { error: 'Keep at least one active admin' }
    await pool.query(
      `UPDATE scorebase_auth.users SET role = COALESCE($2, role), disabled = COALESCE($3, disabled), name = COALESCE($4, name) WHERE id = $1`,
      [data.id, data.role ?? null, data.disabled ?? null, data.name ?? null])
    if (data.disabled) await pool.query('DELETE FROM scorebase_auth.sessions WHERE user_id = $1', [data.id])
    await a.audit(me, 'user.update', { target: target.email, ...data, id: undefined })
    return { error: null }
  })

export const resetPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser('admin')
    const pool = await a.ready()
    const password = a.tempPassword()
    const { rows: [u] } = await pool.query(
      `UPDATE scorebase_auth.users SET password_hash = $2, must_change_password = true WHERE id = $1 RETURNING email`,
      [data.id, await a.hashPassword(password)])
    if (!u) return { error: 'No such user', password: null }
    await pool.query('DELETE FROM scorebase_auth.sessions WHERE user_id = $1', [data.id])
    await a.audit(me, 'user.reset_password', { target: u.email })
    return { error: null, password }
  })

export const deleteUser = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser('admin')
    if (data.id === me.id) return { error: 'You can’t delete your own account' }
    const pool = await a.ready()
    const { rows: [t] } = await pool.query('SELECT email, role, disabled FROM scorebase_auth.users WHERE id = $1', [data.id])
    if (!t) return { error: 'No such user' }
    if (t.role === 'admin' && !t.disabled && (await a.otherActiveAdmins(data.id)) === 0) return { error: 'Keep at least one active admin' }
    await pool.query('DELETE FROM scorebase_auth.users WHERE id = $1', [data.id])
    await a.audit(me, 'user.delete', { target: t.email })
    return { error: null }
  })

export const auditLog = createServerFn({ method: 'GET' })
  .validator(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
  .handler(async ({ data }) => {
    const a = await auth()
    await a.requireUser('admin')
    const { rows } = await (await a.ready()).query(
      'SELECT id, at, email, action, detail, ip FROM scorebase_auth.audit_log ORDER BY at DESC LIMIT $1', [data.limit])
    return rows as { id: number; at: string; email: string | null; action: string; detail: Record<string, Json>; ip: string | null }[]
  })
