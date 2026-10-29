// Production entry: serves the built client assets and hands every other request to the
// TanStack Start fetch handler in dist/server/server.js. No extra dependencies.
//
//   pnpm build && node server.mjs        (PORT, HOST)
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const clientDir = join(here, 'dist', 'client')
const { default: entry } = await import(join(here, 'dist', 'server', 'server.js'))
const handler = typeof entry === 'function' ? entry : entry.fetch

const TYPES = {
  '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.map': 'application/json',
}

function staticFile(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = join(clientDir, rel)
  if (!file.startsWith(clientDir)) return null
  try {
    const st = statSync(file)
    return st.isFile() ? { file, size: st.size } : null
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const hit = staticFile(url.pathname)
  if (hit && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': TYPES[extname(hit.file)] ?? 'application/octet-stream',
      'content-length': hit.size,
      'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    })
    createReadStream(hit.file).pipe(res)
    return
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req)
  const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' })
  let response
  try {
    response = await handler(request)
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Internal error')
    return
  }
  const headers = {}
  response.headers.forEach((v, k) => {
    headers[k] = k === 'set-cookie' ? response.headers.getSetCookie() : v
  })
  res.writeHead(response.status, headers)
  if (response.body) Readable.fromWeb(response.body).pipe(res)
  else res.end()
})

const port = Number(process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
server.listen(port, host, () => console.log(`scorebase app on http://${host}:${port}`))
