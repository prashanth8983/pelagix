// Per-user limits on the expensive paths: model calls and warehouse queries. A fixed
// one-minute window per (user, bucket), counted in Postgres so every app replica shares it.
import { ready } from './auth'

const LIMITS = { ask: 20, query: 120 } as const
const WINDOW_SECONDS = 60

export class RateLimited extends Error {}

export async function limit(userId: string, bucket: keyof typeof LIMITS) {
  const pool = await ready()
  const { rows: [w] } = await pool.query(
    `INSERT INTO scorebase_auth.rate_limits (key, window_start, n) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       n = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.n + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING n, EXTRACT(EPOCH FROM now() - window_start)::int AS age`,
    [`${bucket}:${userId}`, WINDOW_SECONDS])
  if (w.n > LIMITS[bucket]) throw new RateLimited(`Too many requests. Try again in ${Math.max(1, WINDOW_SECONDS - w.age)}s.`)
  // Old windows are of no use; sweep them now and then.
  if (Math.random() < 0.01) await pool.query("DELETE FROM scorebase_auth.rate_limits WHERE window_start < now() - interval '1 day'")
}
