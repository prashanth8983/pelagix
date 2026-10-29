// The Ask box. Verified (golden) queries first, the LLM agent second.
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
  engine?: 'mastra' | 'langgraph'
  attempts?: number
  sql?: string
  columns?: string[]
  rows?: Cell[][]
}

export const ask = createServerFn({ method: 'POST' })
  .validator(z.object({ question: z.string().min(2).max(500) }))
  .handler(async ({ data }): Promise<AskResponse> => {
    const user = await (await import('./auth')).requireUser('viewer')
    ;(await import('./ratelimit')).limit(user.id, 'ask')
    const { matchGolden, runSql } = await import('./scorebase')
    const hasKey = Boolean(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY)

    const match = await matchGolden(data.question)
    if ('sql' in match && match.verified) {
      const r = await runSql(match.sql)
      return {
        source: 'verified',
        answer: `Verified answer to “${match.question}”`,
        matched: match.question,
        ...r,
      }
    }

    if (!hasKey) {
      const near = 'sql' in match && match.score > 0 ? match.question : undefined
      return {
        source: 'none',
        closest: near,
        answer: near
          ? 'No verified query answers exactly that, and no model key is set to write new SQL.'
          : 'No verified query matches that question. Set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in app/.env to let the agent write new SQL.',
      }
    }

    // SCOREBASE_AGENT=langgraph runs the Python LangGraph agent; default is Mastra in TypeScript.
    if (process.env.SCOREBASE_AGENT === 'langgraph') {
      const { askGraph } = await import('./scorebase')
      const g = await askGraph(data.question)
      return { source: 'agent', engine: 'langgraph', answer: g.answer, sql: g.sql, columns: g.columns, rows: g.rows, attempts: g.attempts }
    }
    const { askAgent } = await import('./agent')
    const { answer, result } = await askAgent(data.question)
    return { source: 'agent', engine: 'mastra', answer, ...(result ?? {}) }
  })
