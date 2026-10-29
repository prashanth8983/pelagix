// Server-only helpers for talking to the Python API (engine/scorebase/api.py).
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import type { Golden, QueryResult } from '~/lib/types'

// app/.env wins over the shell: a stale exported key elsewhere must not shadow the app's.
// SCOREBASE_ENV_FILE points at another file, e.g. for a second stack on other ports.
try {
  Object.assign(process.env, parseEnv(readFileSync(process.env.SCOREBASE_ENV_FILE ?? '.env', 'utf8')))
} catch {
  // no .env file: fall back to the real environment
}

export const API_URL = process.env.SCOREBASE_API_URL ?? 'http://localhost:8787'

export type { QueryResult, Golden }
export type Context = {
  name: string
  entity: string
  key: string
  score_table: string
  dialect: string
  model: {
    tables: Record<string, { description?: string; columns: Record<string, string> }>
    joins?: string[]
    synonyms?: Record<string, string>
  }
  golden: Golden[]
  attributes: string[]
  agent: boolean
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors?: string[]) {
    super(message)
  }
}

export async function call<T>(path: string, body?: unknown, method?: 'GET' | 'POST' | 'PUT'): Promise<T> {
  const token = process.env.SCOREBASE_API_TOKEN
  const res = await fetch(API_URL + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new ApiError(json.error ?? json.errors?.join('; ') ?? `API ${res.status}`, res.status, json.errors)
  return json as T
}

// Context changes when the config is saved, so it's cached only briefly.
let cached: { at: number; ctx: Context } | undefined
export async function getContext(): Promise<Context> {
  if (!cached || Date.now() - cached.at > 5_000) cached = { at: Date.now(), ctx: await call<Context>('/context') }
  return cached.ctx
}
export const runSql = (sql: string) => call<QueryResult>('/query', { sql })
export const askGraph = (question: string) =>
  call<{ answer: string; sql?: string; columns?: string[]; rows?: QueryResult['rows']; attempts?: number; trace?: string[] }>(
    '/ask',
    { question },
  )
export const matchGolden = (question: string) =>
  call<(Golden & { score: number; verified: boolean; unmatched: string[] }) | Record<string, never>>('/match', { question })
