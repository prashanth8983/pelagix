// Zero schema for the two tables the engine publishes to Postgres.
// timestamptz columns arrive as epoch milliseconds (number).
import { createBuilder, createSchema, json, number, string, table } from '@rocicorp/zero'

export type Rule = { column: string; op: '>' | '>=' | '<' | '<=' | '=' | '!='; value: number }

const entityScores = table('entity_scores')
  .columns({
    user_id: number(),
    total_spend: number().optional(),
    order_count: number().optional(),
    first_order_at: number().optional(),
    last_order_at: number().optional(),
    days_since_last_order: number().optional(),
    avg_order_value: number().optional(),
    tenure_days: number().optional(),
    ltv: number().optional(),
    churn_risk: number().optional(),
    ltv_decile: number().optional(),
    scored_at: number().optional(),
  })
  .primaryKey('user_id')

const segments = table('segments')
  .columns({
    name: string(),
    label: string().optional(),
    filter: string().optional(),
    rules: json<Rule[]>().optional(),
    position: number().optional(),
    size: number().optional(),
    updated_at: number().optional(),
  })
  .primaryKey('name')

export const schema = createSchema({ tables: [entityScores, segments] })
export const zql = createBuilder(schema)

declare module '@rocicorp/zero' {
  interface DefaultTypes {
    schema: typeof schema
  }
}
