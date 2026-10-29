// Named Zero queries. zero-cache only syncs queries defined here (it calls
// /api/zero/query to resolve them), so the browser can't ask for arbitrary data.
import { defineQueries, defineQuery } from '@rocicorp/zero'
import { z } from 'zod'
import { NUMERIC_SCORES, PROJECT } from '~/generated/project'
import { zql } from './schema'

// Columns a segment rule or sort may use: the numeric scores, from the config.
export const SCORE_COLUMNS = NUMERIC_SCORES
const column = z.enum(NUMERIC_SCORES)

const rule = z.object({
  column,
  op: z.enum(['>', '>=', '<', '<=', '=', '!=']),
  value: z.number(),
})

const scores = zql[PROJECT.scoreTable]

export const queries = defineQueries({
  scores: {
    // One segment's members: all rules must hold.
    members: defineQuery(
      z.object({
        rules: z.array(rule).max(8),
        sortBy: column,
        sortDir: z.enum(['asc', 'desc']),
        limit: z.number().int().min(1).max(500),
      }),
      ({ args: { rules, sortBy, sortDir, limit } }) => {
        let q = scores
        for (const r of rules) q = q.where(r.column, r.op, r.value)
        return q.orderBy(sortBy, sortDir).limit(limit)
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
