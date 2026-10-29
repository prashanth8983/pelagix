// Dashboards: named pages of widgets, stored in Postgres (schema scorebase_app). Server only.
// Widgets hold their own config (a SQL statement, a segment name, a score); the data
// itself is fetched by the page through the same guarded paths as everything else.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Json } from '~/lib/types'

const auth = () => import('./auth')

const SCHEMA = `
  CREATE SCHEMA IF NOT EXISTS scorebase_app;
  CREATE TABLE IF NOT EXISTS scorebase_app.dashboards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    widgets jsonb NOT NULL DEFAULT '[]',
    position int NOT NULL DEFAULT 0,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`
const g = globalThis as unknown as { __sbDashSchema?: Promise<void> }

async function ready() {
  const a = await auth()
  const pool = await a.ready()
  g.__sbDashSchema ??= pool.query(SCHEMA).then(() => undefined).catch((e) => {
    g.__sbDashSchema = undefined
    throw e
  })
  await g.__sbDashSchema
  return pool
}

// ---------- widget shapes ----------

export const WIDGET_TYPES = ['metric', 'segment', 'distribution', 'chart', 'table', 'text'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]
export const FORMATS = ['number', 'money', 'count', 'ratio', 'percent', 'days'] as const

export const CHART_KINDS = ['bar', 'hbar', 'line', 'area', 'pie'] as const
export type ChartKind = (typeof CHART_KINDS)[number]
const sql = z.string().min(1).max(20_000)
const base = { id: z.string().min(1).max(40), title: z.string().trim().min(1).max(120), size: z.union([z.literal(1), z.literal(2), z.literal(3)]) }
const widget = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('metric'), config: z.object({ sql, format: z.enum(FORMATS).optional() }) }),
  z.object({ ...base, type: z.literal('segment'), config: z.object({ segment: z.string().min(1).max(100) }) }),
  z.object({ ...base, type: z.literal('distribution'), config: z.object({ column: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), bins: z.number().int().min(2).max(100).optional() }) }),
  z.object({ ...base, type: z.literal('chart'), config: z.object({
    sql, kind: z.enum(CHART_KINDS), x: z.string().max(200), y: z.string().max(200),
    color: z.number().int().min(1).max(6).optional(),   // series slot; pies and per-category bars use every slot
    perCategory: z.boolean().optional(),                // bars: one color per x value
  }) }),
  z.object({ ...base, type: z.literal('table'), config: z.object({ sql, limit: z.number().int().min(1).max(500).optional() }) }),
  z.object({ ...base, type: z.literal('text'), config: z.object({ body: z.string().max(4000) }) }),
])
export type Widget = z.infer<typeof widget>
const widgets = z.array(widget).max(40)

export type Dashboard = {
  id: string
  name: string
  description: string
  widgets: Widget[]
  position: number
  created_at: string
  updated_at: string
}

const row = (r: Record<string, unknown>): Dashboard => ({
  id: r.id as string,
  name: r.name as string,
  description: r.description as string,
  widgets: (r.widgets as Widget[]) ?? [],
  position: r.position as number,
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
})

// ---------- reads ----------

export const listDashboards = createServerFn({ method: 'GET' }).handler(async (): Promise<Dashboard[]> => {
  await (await auth()).requireUser('viewer')
  const { rows } = await (await ready()).query('SELECT * FROM scorebase_app.dashboards ORDER BY position, created_at')
  return rows.map(row)
})

export const getDashboard = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<Dashboard | null> => {
    await (await auth()).requireUser('viewer')
    const { rows } = await (await ready()).query('SELECT * FROM scorebase_app.dashboards WHERE id = $1', [data.id])
    return rows[0] ? row(rows[0]) : null
  })

// ---------- writes (editors) ----------

export const createDashboard = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).default(''), widgets: widgets.default([]) }))
  .handler(async ({ data }): Promise<Dashboard> => {
    const a = await auth()
    const me = await a.requireUser('editor')
    const pool = await ready()
    const { rows } = await pool.query(
      `INSERT INTO scorebase_app.dashboards (name, description, widgets, position, created_by)
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM scorebase_app.dashboards), $4) RETURNING *`,
      [data.name, data.description, JSON.stringify(data.widgets), me.id])
    await a.audit(me, 'dashboard.create', { id: rows[0].id, name: data.name })
    return row(rows[0])
  })

export const updateDashboard = createServerFn({ method: 'POST' })
  .validator(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    widgets: widgets.optional(),
  }))
  .handler(async ({ data }): Promise<Dashboard | { error: string }> => {
    const a = await auth()
    const me = await a.requireUser('editor')
    const pool = await ready()
    const { rows } = await pool.query(
      `UPDATE scorebase_app.dashboards
       SET name = COALESCE($2, name), description = COALESCE($3, description), widgets = COALESCE($4, widgets), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [data.id, data.name ?? null, data.description ?? null, data.widgets ? JSON.stringify(data.widgets) : null])
    if (!rows[0]) return { error: 'No such dashboard' }
    await a.audit(me, 'dashboard.update', { id: data.id, widgets: data.widgets?.length })
    return row(rows[0])
  })

export const deleteDashboard = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser('editor')
    const { rowCount } = await (await ready()).query('DELETE FROM scorebase_app.dashboards WHERE id = $1', [data.id])
    await a.audit(me, 'dashboard.delete', { id: data.id })
    return { deleted: rowCount ?? 0 }
  })

export const reorderDashboards = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(z.string().uuid()).max(200) }))
  .handler(async ({ data }) => {
    const a = await auth()
    const me = await a.requireUser('editor')
    const pool = await ready()
    for (const [i, id] of data.ids.entries()) {
      await pool.query('UPDATE scorebase_app.dashboards SET position = $2 WHERE id = $1', [id, i])
    }
    await a.audit(me, 'dashboard.reorder', { count: data.ids.length })
    return { ok: true }
  })

export type { Json }
