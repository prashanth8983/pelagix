// Text-to-SQL agent: Mastra + Claude, with one tool that runs guarded SQL.
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { describeModel, getContext, runSql, type QueryResult } from './scorebase'

const MODEL = process.env.SCOREBASE_MODEL ?? 'anthropic/claude-sonnet-5-5'

export async function askAgent(question: string): Promise<{ answer: string; result?: QueryResult }> {
  const ctx = await getContext()
  let last: QueryResult | undefined

  const runSqlTool = createTool({
    id: 'run_sql',
    description:
      'Run one read-only DuckDB SELECT against the tables described in your instructions. ' +
      'Returns columns and up to 500 rows, or an error to fix and retry.',
    inputSchema: z.object({ sql: z.string().describe('A single SELECT statement') }),
    execute: async ({ sql }) => {
      try {
        last = await runSql(sql)
        return { columns: last.columns, rows: last.rows.slice(0, 20), total_rows: last.rows.length }
      } catch (e) {
        return { error: (e as Error).message }
      }
    },
  })

  const agent = new Agent({
    id: 'scorebase-analyst',
    name: 'Scorebase analyst',
    model: MODEL,
    tools: { run_sql: runSqlTool },
    instructions: [
      `You answer a marketer's questions about ${ctx.entity}s by writing DuckDB SQL.`,
      `Prefer the precomputed ${ctx.score_table} table; join raw tables only when needed.`,
      'Always call run_sql before answering. If it returns an error, fix the SQL and retry.',
      'Use the business terms exactly as defined. Never invent tables or columns.',
      'Final answer: two sentences at most, quoting the key numbers. Do not repeat the SQL.',
      '',
      describeModel(ctx),
    ].join('\n'),
  })

  const res = await agent.generate(question, { maxSteps: 5 })
  return { answer: res.text, result: last }
}
