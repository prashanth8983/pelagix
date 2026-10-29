// Request middleware for every response the app server sends.
//
//  - CSRF: server function calls that change state (POST) must come from this site, judged
//    by Sec-Fetch-Site / Origin. GET reads and zero-cache's server-to-server calls to
//    /api/zero/query are left alone.
//  - Security headers, including a CSP in production (dev needs Vite's inline HMR scripts).
//  - A request id on every response, logged with the method, path, status and duration.
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

const prod = process.env.NODE_ENV === 'production'
const zero = process.env.VITE_ZERO_CACHE_URL ?? 'http://localhost:4848'

function csp(): string {
  const ws = zero.replace(/^http/, 'ws')
  return [
    "default-src 'self'",
    // TanStack Start inlines its hydration data and the theme script.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${zero} ${ws}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
}

const HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  ...(prod ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', 'Content-Security-Policy': csp() } : {}),
}

const csrf = createCsrfMiddleware({
  filter: ({ request }) => request.method !== 'GET' && new URL(request.url).pathname.includes('/_serverFn/'),
  failureResponse: () => Response.json({ error: 'Cross-site request blocked' }, { status: 403 }),
})

const headers = createMiddleware().server(async ({ next, request }) => {
  const started = performance.now()
  const id = request.headers.get('x-request-id') ?? crypto.randomUUID()
  const result = await next()
  let response = result.response
  try {
    for (const [k, v] of Object.entries(HEADERS)) response.headers.set(k, v)
    response.headers.set('X-Request-Id', id)
  } catch {
    // Some responses (redirects) have immutable headers: copy them into a new one.
    response = new Response(response.body, response)
    for (const [k, v] of Object.entries(HEADERS)) response.headers.set(k, v)
    response.headers.set('X-Request-Id', id)
  }
  const path = new URL(request.url).pathname
  if (!path.startsWith('/@') && !path.startsWith('/node_modules') && !/\.\w+$/.test(path)) {
    console.log(JSON.stringify({
      at: new Date().toISOString(), id, method: request.method, path,
      status: response.status, ms: Math.round(performance.now() - started),
    }))
  }
  return { ...result, response }
})

export const startInstance = createStart(() => ({
  requestMiddleware: [headers, csrf],
}))
