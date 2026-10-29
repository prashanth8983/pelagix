// The Ask box. Verified (golden) queries first, the LLM agent second.
// A close golden match is answered without any model call: it's exact and instant.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export type Cell = string | number | boolean | null

export type AskResponse = {
  source: 'verified' | 'agent' | 'none'
  answer: string
  matched?: string
  sql?: string
  columns?: string[]
  rows?: Cell[][]
}

const GOLDEN_THRESHOLD = 0.5

export const ask = createServerFn({ method: 'POST' })
  .validator(z.object({ question: z.string().min(2).max(500) }))
  .handler(async ({ data }): Promise<AskResponse> => {
    const { matchGolden, runSql } = await import('./scorebase')
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY)

    const match = await matchGolden(data.question)
    if ('sql' in match && (match.score >= GOLDEN_THRESHOLD || (!hasKey && match.score > 0))) {
      const r = await runSql(match.sql)
      return {
        source: 'verified',
        answer: `Answered from the verified query "${match.question}".`,
        matched: match.question,
        ...r,
      }
    }

    if (!hasKey) {
      return {
        source: 'none',
        answer: 'No verified query matches that question. Set ANTHROPIC_API_KEY to let the agent write new SQL.',
      }
    }

    const { askAgent } = await import('./agent')
    const { answer, result } = await askAgent(data.question)
    return { source: 'agent', answer, ...(result ?? {}) }
  })
