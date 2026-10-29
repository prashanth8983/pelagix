// Named Zero queries. zero-cache only syncs queries defined here (it calls
// /api/zero/query to resolve them), so the browser can't ask for arbitrary data.
import { defineQueries, defineQuery } from '@rocicorp/zero'
import { z } from 'zod'
import { ATTRIBUTES, FILTER_COLUMNS, NUMERIC_SCORES, PROJECT } from '~/generated/project'
import type { Op, Rule } from '~/lib/types'
import { zql } from './schema'

// Columns a segment rule may use (numeric scores and entity attributes) and a sort may use.
export const SCORE_COLUMNS = NUMERIC_SCORES
export const SORT_COLUMNS = [...NUMERIC_SCORES, ...ATTRIBUTES] as const
const filterColumn = z.enum(Object.keys(FILTER_COLUMNS) as [string, ...string[]])
const sortColumn = z.enum(SORT_COLUMNS as unknown as [string, ...string[]])

const scalar = z.union([z.number(), z.string()])
const rule = z.object({
  column: filterColumn,
  op: z.enum(['>', '>=', '<', '<=', '=', '!=', 'in', 'not_in', 'is_null', 'is_not_null']),
  value: z.union([scalar, z.array(scalar).max(50), z.null()]).optional(),
})

const scores = zql[PROJECT.scoreTable]

// The same meaning as scorebase.segments.to_sql, expressed for Zero.
const ZERO_OP: Partial<Record<Op, string>> = { in: 'IN', not_in: 'NOT IN' }
function condition(cmp: (field: string, op: string, value: unknown) => unknown, r: Rule) {
  if (r.op === 'is_null') return cmp(r.column, 'IS', null)
  if (r.op === 'is_not_null') return cmp(r.column, 'IS NOT', null)
  if (r.op === 'in' || r.op === 'not_in') return cmp(r.column, ZERO_OP[r.op]!, Array.isArray(r.value) ? r.value : [r.value])
  return cmp(r.column, r.op, r.value)
}

export const queries = defineQueries({
  scores: {
    // One segment's members: every rule holds (all) or at least one does (any).
    members: defineQuery(
      z.object({
        rules: z.array(rule).max(8),
        match: z.enum(['all', 'any']).default('all'),
        sortBy: sortColumn,
        sortDir: z.enum(['asc', 'desc']),
        limit: z.number().int().min(1).max(500),
      }),
      ({ args: { rules, match, sortBy, sortDir, limit } }) => {
        let q = scores
        if (rules.length) {
          q = q.where(({ cmp, and, or }) => {
            const conds = rules.map((r) => condition(cmp as never, r as Rule)) as never[]
            return match === 'any' ? or(...conds) : and(...conds)
          })
        }
        return q.orderBy(sortBy as never, sortDir).limit(limit)
      },
    ),
    // One entity, for the detail drawer. Updates live like everything else.
    one: defineQuery(z.object({ key: z.union([z.number(), z.string()]) }), ({ args: { key } }) =>
      scores.where(PROJECT.key, '=', key as never).one(),
    ),
  },
  segments: {
    all: defineQuery(() => zql.segments.orderBy('position', 'asc')),
  },
})
