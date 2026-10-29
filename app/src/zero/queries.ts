// Named Zero queries. zero-cache only syncs queries defined here (it calls
// /api/zero/query to resolve them), so the browser can't ask for arbitrary data.
import { defineQueries, defineQuery } from '@rocicorp/zero'
import { z } from 'zod'
import { zql } from './schema'

// Columns a segment rule or sort may use. Mirrors the score table.
export const SCORE_COLUMNS = [
  'ltv', 'churn_risk', 'total_spend', 'ltv_decile', 'order_count',
  'days_since_last_order', 'avg_order_value', 'last_order_at',
] as const

const rule = z.object({
  column: z.enum(SCORE_COLUMNS),
  op: z.enum(['>', '>=', '<', '<=', '=', '!=']),
  value: z.number(),
})

export const queries = defineQueries({
  scores: {
    // One segment's members: all rules must hold.
    members: defineQuery(
      z.object({
        rules: z.array(rule).max(8),
        sortBy: z.enum(SCORE_COLUMNS),
        sortDir: z.enum(['asc', 'desc']),
        limit: z.number().int().min(1).max(200),
      }),
      ({ args: { rules, sortBy, sortDir, limit } }) => {
        let q = zql.entity_scores
        for (const r of rules) q = q.where(r.column, r.op, r.value)
        return q.orderBy(sortBy, sortDir).limit(limit)
      },
    ),
  },
  segments: {
    all: defineQuery(() => zql.segments.orderBy('position', 'asc')),
  },
})
