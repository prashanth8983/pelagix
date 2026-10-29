// Per-user limits on the expensive paths: model calls and warehouse queries. A fixed
// one-minute window per (user, bucket), in memory, so each app instance counts its own.
const LIMITS = { ask: 20, query: 120 } as const
const windows = new Map<string, { start: number; n: number }>()

export class RateLimited extends Error {}

export function limit(userId: string, bucket: keyof typeof LIMITS) {
  const key = `${bucket}:${userId}`
  const now = Date.now()
  const w = windows.get(key)
  if (!w || now - w.start > 60_000) {
    windows.set(key, { start: now, n: 1 })
    return
  }
  if (++w.n > LIMITS[bucket]) {
    const wait = Math.ceil((60_000 - (now - w.start)) / 1000)
    throw new RateLimited(`Too many requests. Try again in ${wait}s.`)
  }
}
