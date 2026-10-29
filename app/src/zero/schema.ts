// Zero schema for the two tables the engine publishes to Postgres. The score table's
// columns come from the project config (src/generated/project.ts, written by codegen).
// timestamptz columns arrive as epoch milliseconds (number).
import { createBuilder, createSchema, json, number, string, table } from '@rocicorp/zero'
import { scoreTable } from '~/generated/project'
import type { Rule } from '~/lib/types'

export type { Rule }

const segments = table('segments')
  .columns({
    name: string(),
    label: string().optional(),
    description: string().optional(),
    match: string().optional(),
    filter: string().optional(),
    rules: json<Rule[]>().optional(),
    position: number().optional(),
    size: number().optional(),
    updated_at: number().optional(),
  })
  .primaryKey('name')

export const schema = createSchema({ tables: [scoreTable, segments] })
export const zql = createBuilder(schema)

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: typeof schema
  }
}
