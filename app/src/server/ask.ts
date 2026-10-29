// The Ask box. Verified (golden) queries first, the engine's LangGraph agent second.
// A verified match is answered without any model call: it's exact and instant. The engine
// decides what counts as a match (engine/scorebase/golden.py): a question that adds a
// filter or a negation the golden query doesn't have is never answered from it.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Cell } from '~/lib/types'

export type { Cell }

export type AskResponse = {
  source: 'verified' | 'agent' | 'none'
  answer: string
  matched?: string
  closest?: string
  attempts?: number
  sql?: string
  columns?: string[]
  rows?: Cell[][]
}

export const ask = createServerFn({ method: 'POST' })
  .validator(z.object({ question: z.string().min(2).max(500) }))
  .handler(async ({ data }): Promise<AskResponse> => {
    const user = await (await import('./auth')).requireUser('viewer')
    await (await import('./ratelimit')).limit(user.id, 'ask')
    const { askGraph, getContext, matchGolden, runSql } = await import('./scorebase')

    const match = await matchGolden(data.question)
    if ('sql' in match && match.verified) {
      const r = await runSql(match.sql)
      return { source: 'verified', answer: `Verified answer to “${match.question}”`, matched: match.question, ...r }
    }

    if (!(await getContext()).agent) {
      const near = 'sql' in match && match.score > 0 ? match.question : undefined
      return {
        source: 'none',
        closest: near,
        answer: near
          ? 'No verified answer for that, and no model is configured.'
          : 'No verified answer. Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY to enable the agent.',
      }
    }

    const g = await askGraph(data.question)
    return { source: 'agent', answer: g.answer, sql: g.sql, columns: g.columns, rows: g.rows, attempts: g.attempts }
  })
