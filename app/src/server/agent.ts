// Text-to-SQL agent: Mastra + an LLM, with one tool that runs guarded SQL.
import { Agent } from '@mastra/core/agent'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { describeModel, getContext, runSql, type QueryResult } from './scorebase'

// Any provider Mastra's model router knows. OpenRouter if its key is set, else Anthropic.
// Override with SCOREBASE_MODEL, e.g. openrouter/openai/gpt-oss-120b. Resolved per call,
// and the key is passed explicitly, so it works however the environment was loaded.
function pickModel(): { id: `${string}/${string}`; apiKey?: string } {
  const or = process.env.OPENROUTER_API_KEY
  const id = (process.env.SCOREBASE_MODEL ??
    (or ? 'openrouter/anthropic/claude-sonnet-4-6' : 'anthropic/claude-sonnet-5-5')) as `${string}/${string}`
  return { id, apiKey: id.startsWith('openrouter/') ? or : process.env.ANTHROPIC_API_KEY }
}

const DIALECTS: Record<string, string> = { duckdb: 'DuckDB', snowflake: 'Snowflake' }

export async function askAgent(question: string): Promise<{ answer: string; result?: QueryResult }> {
  const ctx = await getContext()
  let last: QueryResult | undefined

  const runSqlTool = createTool({
    id: 'run_sql',
    description:
      `Run one read-only ${DIALECTS[ctx.dialect] ?? ctx.dialect} SELECT against the tables described in your instructions. ` +
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
    model: pickModel(),
    tools: { run_sql: runSqlTool },
    instructions: [
      `You answer a business user's questions about ${ctx.entity}s by writing ${DIALECTS[ctx.dialect] ?? ctx.dialect} SQL.`,
      `Prefer the precomputed ${ctx.score_table} table; join raw tables only when needed.`,
      'Always call run_sql before answering. If it returns an error, fix the SQL and retry.',
      'Use the business terms exactly as defined. Never invent tables or columns.',
      'Final answer: plain text, no markdown, two sentences at most, quoting the key numbers. Do not repeat the SQL.',
      '',
      describeModel(ctx),
    ].join('\n'),
  })

  const res = await agent.generate(question, { maxSteps: 5, modelSettings: { maxOutputTokens: 1500 } })
  return { answer: res.text, result: last }
}
