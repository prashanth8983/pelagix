// Server functions for the configuration pages, the SQL workspace and pipeline runs.
// Everything goes through the Python API, which validates and owns the files.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Config, QueryResult, Run, Section, WarehouseTable } from '~/lib/types'

const section = z.enum(['project', 'sources', 'scores', 'segments', 'model', 'golden'])
const api = async () => import('./scorebase')
// viewer: read and query. editor: change config, preview sources, run the pipeline.
const guard = async (role: 'viewer' | 'editor' | 'admin') => (await import('./auth')).requireUser(role)
const audit = async (user: { id: string; email: string }, action: string, detail?: Record<string, unknown>) =>
  (await import('./auth')).audit(user, action, detail)

// Validation failures come back as data so the editor can show them next to the fields.
async function attempt<T>(fn: () => Promise<T>): Promise<T | { errors: string[] }> {
  const { ApiError } = await api()
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ApiError && e.errors) return { errors: e.errors }
    throw e
  }
}

export const getConfig = createServerFn({ method: 'GET' }).handler(async () => {
    const user = await guard('viewer')
  const { call } = await api()
  return call<Config>('/config')
})

export const saveSection = createServerFn({ method: 'POST' })
  .validator(z.object({ section, data: z.any() }))
  .handler(async ({ data }) => {
    const user = await guard('editor')
    const { call } = await api()
    const r = await attempt(() => call<{ errors: string[] }>(`/config/${data.section}`, { data: data.data }, 'PUT'))
    if (!r.errors.length) await audit(user, 'config.save', { section: data.section })
    return r
  })

export const validateSection = createServerFn({ method: 'POST' })
  .validator(z.object({ section, data: z.any() }))
  .handler(async ({ data }) => {
    const user = await guard('editor')
    const { call } = await api()
    return call<{ errors: string[] }>(`/config/${data.section}/validate`, { data: data.data })
  })

export const sectionHistory = createServerFn({ method: 'GET' })
  .validator(z.object({ section }))
  .handler(async ({ data }) => {
    const user = await guard('editor')
    const { call } = await api()
    return call<{ id: string; saved_at: string; text: string }[]>(`/config/${data.section as Section}/history`)
  })

export const previewSource = createServerFn({ method: 'POST' })
  .validator(z.object({ source: z.any() }))
  .handler(async ({ data }) => {
    const user = await guard('editor')
    const { call } = await api()
    return call<{ columns: { name: string; type: string }[]; rows: QueryResult['rows'] }>('/preview/source', data)
  })

export type ScoresPreview = {
  errors?: string[]
  error?: string
  sql: string
  plan: { name: string; layer: number; depends_on: string[] }[]
  columns?: string[]
  rows?: QueryResult['rows']
  stats?: Record<string, string | number | null>[]
}

export const previewScores = createServerFn({ method: 'POST' })
  .validator(z.object({ scores: z.any().optional() }))
  .handler(async ({ data }) => {
    const user = await guard('editor')
    const { call } = await api()
    return attempt(() => call<ScoresPreview>('/preview/scores', data))
  })

export const previewSegment = createServerFn({ method: 'POST' })
  .validator(z.object({ rules: z.array(z.object({ column: z.string(), op: z.string(), value: z.number() })) }))
  .handler(async ({ data }) => {
    const user = await guard('viewer')
    ;(await import('./ratelimit')).limit(user.id, 'query')
    const { call } = await api()
    return call<{ errors?: string[]; where?: string; size?: number; total?: number }>('/preview/segment', data)
  })

export const warehouseTables = createServerFn({ method: 'GET' }).handler(async () => {
    const user = await guard('viewer')
  const { call } = await api()
  return call<WarehouseTable[]>('/warehouse/tables')
})

export const runQuery = createServerFn({ method: 'POST' })
  .validator(z.object({ sql: z.string().min(1).max(20_000) }))
  .handler(async ({ data }) => {
    const user = await guard('viewer')
    ;(await import('./ratelimit')).limit(user.id, 'query')
    const { runSql } = await api()
    return runSql(data.sql)
  })

export const formatSql = createServerFn({ method: 'POST' })
  .validator(z.object({ sql: z.string().max(20_000) }))
  .handler(async ({ data }) => {
    await guard('viewer')
    const { call } = await api()
    return call<{ sql: string }>('/format', data)
  })

export const matchQuestion = createServerFn({ method: 'POST' })
  .validator(z.object({ question: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const user = await guard('viewer')
    const { matchGolden } = await api()
    return matchGolden(data.question)
  })

export const evalGolden = createServerFn({ method: 'POST' }).handler(async () => {
    const user = await guard('editor')
  const { call } = await api()
  return call<{ question: string; ok: boolean; rows?: number; error?: string }[]>('/eval', {})
})

export const listRuns = createServerFn({ method: 'GET' }).handler(async () => {
    const user = await guard('viewer')
  const { call } = await api()
  return call<Run[]>('/runs')
})

export const startRun = createServerFn({ method: 'POST' })
  .validator(z.object({ publish: z.boolean().default(true) }))
  .handler(async ({ data }) => {
    const user = await guard('editor')
    const { call } = await api()
    const r = await attempt(() => call<Run>('/runs', data))
    if (!('errors' in r)) await audit(user, 'run.start', { run: r.id, publish: data.publish })
    return r
  })

// One score's distribution for the overview chart: 20 equal-width bins up to the 99th
// percentile, so a long tail doesn't squash everything into the first bar.
export const distribution = createServerFn({ method: 'POST' })
  .validator(z.object({ column: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }))
  .handler(async ({ data }) => {
    const user = await guard('viewer')
    ;(await import('./ratelimit')).limit(user.id, 'query')
    const { runSql } = await api()
    const c = data.column
    return runSql(`WITH v AS (SELECT CAST(${c} AS DOUBLE) AS x FROM ${data.table} WHERE ${c} IS NOT NULL),
      b AS (SELECT MIN(x) AS lo, QUANTILE_CONT(x, 0.99) AS hi FROM v)
      SELECT LEAST(CAST(FLOOR((x - lo) / NULLIF((hi - lo) / 20, 0)) AS INTEGER), 19) AS bin,
             MIN(x) AS lo, MAX(x) AS hi, COUNT(*) AS n
      FROM v, b GROUP BY 1 ORDER BY 1`)
  })
