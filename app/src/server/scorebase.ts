// Server-only helpers for talking to the Python query API (engine/scorebase/api.py).
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

// app/.env wins over the shell: a stale exported key elsewhere must not shadow the app's.
try {
  Object.assign(process.env, parseEnv(readFileSync('.env', 'utf8')))
} catch {
  // no .env file: fall back to the real environment
}

export const API_URL = process.env.SCOREBASE_API_URL ?? 'http://localhost:8787'

export type QueryResult = { sql: string; columns: string[]; rows: (string | number | boolean | null)[][] }
export type Golden = { question: string; sql: string }
export type Context = {
  entity: string
  key: string
  score_table: string
  model: {
    tables: Record<string, { description?: string; columns: Record<string, string> }>
    joins?: string[]
    synonyms?: Record<string, string>
  }
  golden: Golden[]
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `query API ${res.status}`)
  return json as T
}

let cached: Context | undefined
export const getContext = async () => (cached ??= await call<Context>('/context'))
export const runSql = (sql: string) => call<QueryResult>('/query', { sql })
export const matchGolden = (question: string) =>
  call<(Golden & { score: number }) | Record<string, never>>('/match', { question })

// The semantic layer as prompt text: tables, columns, joins, business terms, examples.
export function describeModel(ctx: Context): string {
  const tables = Object.entries(ctx.model.tables)
    .map(([name, t]) => {
      const cols = Object.entries(t.columns).map(([c, d]) => `    ${c}: ${d}`).join('\n')
      return `  ${name} -- ${t.description ?? ''}\n${cols}`
    })
    .join('\n')
  const joins = (ctx.model.joins ?? []).map((j) => `  ${j}`).join('\n')
  const terms = Object.entries(ctx.model.synonyms ?? {}).map(([k, v]) => `  "${k}" means ${v}`).join('\n')
  const examples = ctx.golden.map((g) => `Q: ${g.question}\nSQL:\n${g.sql.trim()}`).join('\n\n')
  return `TABLES\n${tables}\n\nJOINS\n${joins}\n\nBUSINESS TERMS\n${terms}\n\nVERIFIED EXAMPLES\n${examples}`
}
