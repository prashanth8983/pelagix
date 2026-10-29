// Users, sessions and the audit log, in Postgres. Server only.
//
// Tables live in their own schema, scorebase_auth, so Zero (which replicates `public`)
// never copies password hashes or sessions into its replica.
// Passwords: scrypt with a per-user salt. Sessions: a random token in an httpOnly cookie;
// only its SHA-256 is stored, so a database leak doesn't hand out live sessions.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { deleteCookie, getCookie, getRequestHeader, getRequestIP, setCookie } from '@tanstack/react-start/server'
import pg from 'pg'
import './scorebase' // loads app/.env

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>

export const ROLES = ['viewer', 'editor', 'admin'] as const
export type Role = (typeof ROLES)[number]
export type User = { id: string; email: string; name: string; role: Role; disabled: boolean; created_at: string; last_login_at: string | null }

const COOKIE = 'sb_session'
const SESSION_DAYS = 14
export const MIN_PASSWORD = 10

const g = globalThis as unknown as { __sbPool?: pg.Pool; __sbSchema?: Promise<void> }

export function db(): pg.Pool {
  const url = process.env.SCOREBASE_PG_URL
  if (!url) throw new Error('Set SCOREBASE_PG_URL in app/.env: users and sessions are stored in Postgres')
  g.__sbPool ??= new pg.Pool({ connectionString: url, max: 5 })
  return g.__sbPool
}

const SCHEMA = `
  CREATE SCHEMA IF NOT EXISTS scorebase_auth;
  CREATE TABLE IF NOT EXISTS scorebase_auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    name text NOT NULL DEFAULT '',
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
    disabled boolean NOT NULL DEFAULT false,
    must_change_password boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email ON scorebase_auth.users (lower(email));
  CREATE TABLE IF NOT EXISTS scorebase_auth.sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES scorebase_auth.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    ip text,
    user_agent text
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON scorebase_auth.sessions (user_id);
  CREATE TABLE IF NOT EXISTS scorebase_auth.audit_log (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES scorebase_auth.users(id) ON DELETE SET NULL,
    email text,
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip text
  );
  CREATE INDEX IF NOT EXISTS audit_at ON scorebase_auth.audit_log (at DESC);
  CREATE TABLE IF NOT EXISTS scorebase_auth.login_failures (
    key text PRIMARY KEY,
    n int NOT NULL,
    until timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scorebase_auth.rate_limits (
    key text PRIMARY KEY,
    window_start timestamptz NOT NULL,
    n int NOT NULL
  );
`

/** Create the auth tables once per process. Safe to call on every request. */
export async function ready(): Promise<pg.Pool> {
  const pool = db()
  g.__sbSchema ??= pool.query(SCHEMA).then(() => undefined).catch((e) => {
    g.__sbSchema = undefined
    throw e
  })
  await g.__sbSchema
  return pool
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt') return false
  const want = Buffer.from(hash, 'base64')
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p })
  return timingSafeEqual(want, got)
}

export function checkPassword(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters`
  if (pw.length > 200) return 'Password too long'
  return null
}

export const tempPassword = () => randomBytes(12).toString('base64url')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const ip = () => {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? null
  } catch {
    return null
  }
}

// Failed sign-ins are counted per email and per address in 15-minute windows. Five for an
// email locks that email; twenty from one address locks the address (offices and test
// runners share addresses). Counters live in Postgres so every app replica sees them.
const LOCK_AFTER_EMAIL = 5
const LOCK_AFTER_IP = 20
const LOCK_MINUTES = 15
const failureKeys = (email: string) => [email.toLowerCase(), `ip:${ip()}`]

export async function lockedOut(email: string): Promise<boolean> {
  const [emailKey, ipKey] = failureKeys(email)
  const { rows } = await (await ready()).query(
    `SELECT 1 FROM scorebase_auth.login_failures
     WHERE until > now() AND ((key = $1 AND n >= $2) OR (key = $3 AND n >= $4)) LIMIT 1`,
    [emailKey, LOCK_AFTER_EMAIL, ipKey, LOCK_AFTER_IP])
  return rows.length > 0
}

export async function noteFailure(email: string) {
  const pool = await ready()
  for (const key of failureKeys(email)) {
    await pool.query(
      `INSERT INTO scorebase_auth.login_failures (key, n, until) VALUES ($1, 1, now() + make_interval(mins => $2))
       ON CONFLICT (key) DO UPDATE SET
         n = CASE WHEN login_failures.until < now() THEN 1 ELSE login_failures.n + 1 END,
         until = CASE WHEN login_failures.until < now() THEN now() + make_interval(mins => $2) ELSE login_failures.until END`,
      [key, LOCK_MINUTES])
  }
}

export async function clearFailures(email: string) {
  await (await ready()).query('DELETE FROM scorebase_auth.login_failures WHERE key = $1', [email.toLowerCase()])
}

export async function startSession(userId: string) {
  const pool = await ready()
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `INSERT INTO scorebase_auth.sessions (token_hash, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [sha(token), userId, SESSION_DAYS, ip(), getRequestHeader('user-agent')?.slice(0, 300) ?? null],
  )
  await pool.query('UPDATE scorebase_auth.users SET last_login_at = now() WHERE id = $1', [userId])
  setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export async function endSession() {
  const token = getCookie(COOKIE)
  if (token) await (await ready()).query('DELETE FROM scorebase_auth.sessions WHERE token_hash = $1', [sha(token)])
  deleteCookie(COOKIE, { path: '/' })
}

/** The stored hash of this request's session token, to tell "this session" from the others. */
export async function currentTokenHash(): Promise<string | null> {
  const token = getCookie(COOKIE)
  return token ? sha(token) : null
}

export type SessionUser = User & { must_change_password: boolean }

/** The signed-in user for this request, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = getCookie(COOKIE)
  if (!token) return null
  const pool = await ready()
  const { rows } = await pool.query(
    `UPDATE scorebase_auth.sessions s SET last_seen_at = now()
     FROM scorebase_auth.users u
     WHERE s.token_hash = $1 AND u.id = s.user_id AND s.expires_at > now() AND NOT u.disabled
     RETURNING u.id, u.email, u.name, u.role, u.disabled, u.must_change_password, u.created_at, u.last_login_at`,
    [sha(token)],
  )
  return rows[0] ?? null
}

export class AuthError extends Error {}

/** The current user if their role is at least `role`; throws otherwise. */
export async function requireUser(role: Role = 'viewer'): Promise<SessionUser> {
  const u = await currentUser()
  if (!u) throw new AuthError('Sign in to continue')
  if (ROLES.indexOf(u.role) < ROLES.indexOf(role)) throw new AuthError(`This needs the ${role} role`)
  return u
}

export async function audit(user: { id: string; email: string } | null, action: string, detail: Record<string, unknown> = {}) {
  await (await ready()).query(
    'INSERT INTO scorebase_auth.audit_log (user_id, email, action, detail, ip) VALUES ($1, $2, $3, $4, $5)',
    [user?.id ?? null, user?.email ?? (detail.email as string) ?? null, action, JSON.stringify(detail), ip()],
  )
}

export async function countUsers(): Promise<number> {
  const { rows } = await (await ready()).query('SELECT COUNT(*)::int AS n FROM scorebase_auth.users')
  return rows[0].n
}

/** Admins who are not disabled, other than `exceptId`. Guards against locking everyone out. */
export async function otherActiveAdmins(exceptId: string): Promise<number> {
  const { rows } = await (await ready()).query(
    `SELECT COUNT(*)::int AS n FROM scorebase_auth.users WHERE role = 'admin' AND NOT disabled AND id <> $1`, [exceptId])
  return rows[0].n
}
