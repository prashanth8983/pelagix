// Liveness and readiness for a load balancer or orchestrator. Public, and says only
// whether each dependency answers, never why it doesn't.
import { createFileRoute } from '@tanstack/react-router'

async function check(fn: () => Promise<unknown>, ms = 2000): Promise<boolean> {
  try {
    await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))])
    return true
  } catch {
    return false
  }
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const { db } = await import('~/server/auth')
        const { call } = await import('~/server/scorebase')
        const checks = {
          postgres: await check(() => db().query('SELECT 1')),
          engine: await check(() => call('/health')),
        }
        const ok = Object.values(checks).every(Boolean)
        return Response.json({ ok, checks }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
      },
    },
  },
})
