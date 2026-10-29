// Config shapes, mirroring engine/scorebase/schema.py. The engine validates; these are for editing.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

export type Op = '>' | '>=' | '<' | '<=' | '=' | '!=' | 'in' | 'not_in' | 'is_null' | 'is_not_null'
export const OPS: Op[] = ['>', '>=', '<', '<=', '=', '!=', 'in', 'not_in', 'is_null', 'is_not_null']
export const OP_LABELS: Record<Op, string> = {
  '>': 'greater than', '>=': 'at least', '<': 'less than', '<=': 'at most', '=': 'is', '!=': 'is not',
  in: 'is one of', not_in: 'is none of', is_null: 'is empty', is_not_null: 'is set',
}
/** Operators that make sense for a column kind. */
export const OPS_FOR: Record<'number' | 'string', Op[]> = {
  number: ['>', '>=', '<', '<=', '=', '!=', 'in', 'not_in', 'is_null', 'is_not_null'],
  string: ['=', '!=', 'in', 'not_in', 'is_null', 'is_not_null'],
}

export type Scalar = number | string
export type Rule = { column: string; op: Op; value?: Scalar | Scalar[] | null }

export type Display = {
  entity_label?: string
  columns?: string[]
  highlight?: string | null
  default_sort?: string | null
  sort_dir?: 'asc' | 'desc'
}

export type WarehouseKind = 'duckdb' | 'postgres' | 'snowflake'

export type ProjectCfg = {
  name?: string
  entity?: string
  key: string
  entity_table?: string | null
  entity_key?: string | null
  attributes?: string[]
  warehouse?: { kind?: WarehouseKind; path?: string; url_env?: string; database?: string; schema?: string; compute?: string }
  publish?: { postgres_url_env?: string; table?: string; history?: boolean }
  display?: Display
}

export type Checks = { columns?: string[]; not_null?: string[]; unique?: string[]; min_rows?: number | null }

export type Connector = 'csv' | 'parquet' | 'json' | 'postgres'
export const CONNECTORS: Connector[] = ['csv', 'parquet', 'json', 'postgres']

export type Source = {
  name: string
  connector?: Connector
  path?: string
  dsn_env?: string
  table?: string
  query?: string
  options?: Record<string, Json>
  mode?: 'replace' | 'incremental'
  cursor?: string
  checks?: Checks
}

export const FORMATS = ['number', 'money', 'count', 'ratio', 'percent', 'days', 'date', 'text'] as const
export type Format = (typeof FORMATS)[number]

export type Score = {
  name: string
  sql: string
  label?: string
  description?: string
  format?: Format
  default?: number | null
  window?: boolean
  // An aggregate over another table: its own FROM (with joins), WHERE and key expression.
  from?: string
  where?: string
  key_expr?: string
}

export type ScoresCfg = { from: string; where?: string; key_expr: string; scores: Score[] }

export type Segment = { name: string; label?: string; description?: string; match?: 'all' | 'any'; rules: Rule[] }

export type ModelCfg = {
  tables: Record<string, { description?: string; columns: Record<string, string> }>
  joins?: string[]
  synonyms?: Record<string, string>
}

export type Golden = { question: string; sql: string }

export type Config = {
  project: ProjectCfg
  sources: Source[]
  scores: ScoresCfg
  segments: Segment[]
  model: ModelCfg
  golden: Golden[]
  errors: string[]
}

export type Section = Exclude<keyof Config, 'errors'>

export type Cell = string | number | boolean | null
export type QueryResult = { sql: string; columns: string[]; rows: Cell[][] }

export type Step = { step: string; status: 'running' | 'ok' | 'failed'; seconds?: number; result?: Json; error?: string }
export type Run = {
  id: string
  status: 'running' | 'ok' | 'failed'
  started_at: number
  finished_at: number | null
  steps: Step[]
  log: string[]
  error?: string | null
}

export type WarehouseTable = { name: string; rows: number; columns: { name: string; type: string }[] }
