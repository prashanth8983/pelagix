# Configuration reference

A project is a directory under `configs/` (or any directory passed to the CLI) with six YAML files. The engine validates all of them with the same rules the app's editor uses, so an error reads the same in `scorebase validate`, in the API and on screen. Error messages name the field: `scores.3.sql: ...` means the fourth score's `sql`.

Names (`key`, score names, source names, segment names, columns in rules) must match `[A-Za-z_][A-Za-z0-9_]*`. Unknown keys are rejected.

Paths are relative to `SCOREBASE_HOME`, which defaults to the current directory when it has `configs/`, else the repository root.

## project.yaml

What each score row describes, where the warehouse is, where scores are published, and how the app lists entities.

```yaml
name: retail
entity: customer          # singular; used in prompts and the UI
key: user_id              # the score table's primary key column
entity_table: users       # optional: every row here gets scores, even with no activity
entity_key: id            # required with entity_table: its key column
attributes: [state, traffic_source]   # optional: columns copied from entity_table

warehouse:
  kind: duckdb            # duckdb | postgres | snowflake
  path: data/retail.duckdb

publish:
  postgres_url_env: SCOREBASE_PG_URL
  table: entity_scores
  history: false

display:
  entity_label: Customers
  columns: [ltv, total_spend, order_count, last_order_at]
  highlight: churn_risk
  default_sort: ltv
  sort_dir: desc
```

| Field | Default | Meaning |
|---|---|---|
| `name` | directory name | Shown in the app. |
| `entity` | `entity` | Singular noun for one row. |
| `key` | required | Column that identifies the entity in the score table. Must not also be a score name. |
| `entity_table`, `entity_key` | none | Go together. `entity_table` must be a source. With them, the score table has one row per entity-table row and entities with no activity get each score's `default` (or NULL). Without them, only entities with rows in the base query get a row. |
| `attributes` | `[]` | Columns of `entity_table` copied into the score table as they are (text, numbers, dates). They can be filtered in segments, shown in the members table and used by the agent. Requires `entity_table`. |
| `warehouse.kind` | `duckdb` | See warehouses below. |
| `warehouse.path` | `data/<name>.duckdb` | DuckDB file. |
| `warehouse.url_env` | `SCOREBASE_WAREHOUSE_URL` | Postgres: environment variable holding the connection URL. |
| `warehouse.schema` | `warehouse` (Postgres), `PUBLIC` (Snowflake) | Schema the raw and score tables live in. |
| `warehouse.database`, `warehouse.compute` | from `SNOWFLAKE_*` | Snowflake only. |
| `publish.postgres_url_env` | `SCOREBASE_PG_URL` | Environment variable with the app database URL. The URL itself is never in config. |
| `publish.table` | `entity_scores` | Name of the score table, in the warehouse and in Postgres. |
| `publish.history` | `false` | Keep `<table>_history`: one row per entity per run, with `scored_at`. It grows by the size of the score table on every run. |
| `display.entity_label` | entity, capitalised, plural | Plural label in the app. |
| `display.columns` | first five numeric scores | Scores (or attributes) shown in the members table, in order. |
| `display.highlight` | none | A 0 to 1 score drawn as a bar. |
| `display.default_sort`, `display.sort_dir` | first numeric score, `desc` | Initial sort. |

### Warehouses

`duckdb` is a local file and needs no service. Sources are read with DuckDB's own readers. The query API opens it read-only with file and network access disabled.

`postgres` keeps raw tables, the score table and segment counts in a schema of a Postgres database (which may be the app database). Sources are read by an in-memory DuckDB, typed, and copied in. Scoring SQL runs in Postgres, so score expressions must be valid Postgres SQL. Floating point columns land as `numeric` so that `ROUND(x, 2)` works. For the query API, use a role with SELECT on the warehouse schema only.

`snowflake` is written but has not been run against a live account. Its loader handles local csv, parquet and json files in `replace` mode only. Treat it as a starting point.

## sources.yaml

A list. Each source lands as one raw table named after it, then its checks run. A failed check stops the run before anything is scored or published.

```yaml
- name: orders
  connector: csv              # csv | parquet | json | postgres
  path: data/retail/orders.csv
  options: {delim: ",", header: true}
  mode: replace               # replace | incremental
  checks: {not_null: [order_id, user_id, created_at], unique: [order_id]}
- name: events
  connector: parquet
  path: s3://my-bucket/exports/events/*.parquet
  mode: incremental
  cursor: created_at
- name: accounts
  connector: postgres
  dsn_env: CRM_DB_URL
  table: public.accounts      # or `query: SELECT ...`
```

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Raw table name. |
| `connector` | `csv` | File readers, or `postgres`. |
| `path` | required for file connectors | A file, a glob, or a URL. Local paths must be under `$SCOREBASE_HOME/data`. URLs (`s3://`, `gs://`, `https://`) are allowed only when they start with a prefix listed in `SCOREBASE_REMOTE_SOURCES`. |
| `options` | `{}` | Passed to the reader by name, for example `delim`, `header`, `types`. |
| `dsn_env`, `table`, `query` | required for `postgres` | The environment variable holding the source database URL, and either a `schema.table` or a query. |
| `mode` | `replace` | `incremental` appends only rows whose `cursor` is above the table's current maximum. |
| `cursor` | required for incremental | A column that only grows. |
| `checks.columns` | `[]` | Columns that must exist. |
| `checks.not_null` | `[]` | Columns with no NULLs. |
| `checks.unique` | `[]` | Columns with no duplicates. |
| `checks.min_rows` | none | Fewest rows allowed. |

## scores.yaml

The base query, and one entry per score. The engine builds a single statement: a first layer of aggregates grouped by the key, then one SELECT per dependency layer for scores that use other scores by name.

```yaml
from: |
  order_items oi
  JOIN orders o ON o.order_id = oi.order_id
where: "oi.status NOT IN ('Cancelled', 'Returned')"
key_expr: oi.user_id

scores:
  - name: total_spend
    sql: "ROUND(SUM(oi.sale_price), 2)"
    label: Spent
    format: money
    default: 0
  - name: sessions_30d
    from: events e
    where: "e.created_at > CURRENT_DATE - 30"
    key_expr: e.user_id
    sql: "COUNT(DISTINCT e.session_id)"
    format: count
    default: 0
  - name: avg_order_value
    sql: "ROUND(total_spend / NULLIF(order_count, 0), 2)"
    format: money
  - name: ltv_decile
    sql: "NTILE(10) OVER (ORDER BY ltv)"
    window: true
    format: count
```

Top level:

| Field | Meaning |
|---|---|
| `from` | Tables and joins the aggregate scores read. Required. |
| `where` | Optional row filter applied before grouping. |
| `key_expr` | Expression grouped by; it becomes the key column. Required. |
| `scores` | At least one. Names must be unique. |

Per score:

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Column in the score table. |
| `sql` | required | An aggregate expression over the base query, or an expression over other scores. A score whose SQL mentions another score's name (as a whole word, not inside a string literal or after a dot) is computed after it. Cycles are an error. |
| `from`, `where`, `key_expr` | the top-level values | A score with its own base query aggregates from a different table. Scores with the same `from`, `where` and `key_expr` are grouped into one aggregate; the groups are joined on the key. |
| `label`, `description` | name | Shown in the app and given to the agent. |
| `format` | `number` | `number`, `money`, `count`, `ratio` (0 to 1, shown as a percentage), `percent`, `days`, `date`, `text`. |
| `default` | none | Value for entities with no rows in the base query. Needs `entity_table`. |
| `window` | `false` | Marks a window function such as `NTILE`; it must use another score and cannot be in the first layer. |

Time windows are plain SQL in the expression, for example `SUM(CASE WHEN o.created_at > CURRENT_DATE - 90 THEN oi.sale_price END)`, or a separate base query with its own `where` as in `sessions_30d` above.

## segments.yaml

A list of saved groups over the score table. Rules are stored as data, not SQL, so the same segment runs in the warehouse for counts and in the browser through Zero.

```yaml
- name: vip_texas
  label: VIPs in Texas
  description: Top two deciles with a Texas address
  match: all                        # all | any
  rules:
    - {column: ltv_decile, op: ">=", value: 9}
    - {column: state, op: "=", value: Texas}
- name: lapsed_or_risky
  label: Lapsed or at risk
  match: any
  rules:
    - {column: days_since_last_order, op: ">", value: 60}
    - {column: churn_risk, op: ">", value: 0.7}
- name: no_channel
  label: Unknown channel
  rules:
    - {column: traffic_source, op: is_null}
- name: paid
  label: Paid channels
  rules:
    - {column: traffic_source, op: in, value: [Facebook, Display]}
```

| Field | Default | Meaning |
|---|---|---|
| `name` | required | Stable id. The segment named `all` with no rules means everyone. |
| `label`, `description` | name | Shown on the overview. |
| `match` | `all` | `all`: every rule must hold. `any`: at least one. |
| `rules` | `[]` | Up to 8. |

A rule has `column` (a score or an attribute), `op` and, for most operators, `value`.

| Operator | Value |
|---|---|
| `>`, `>=`, `<`, `<=` | a number |
| `=`, `!=` | a number or a string |
| `in`, `not_in` | a list of numbers or strings |
| `is_null`, `is_not_null` | none |

Booleans are not accepted as values. Mixing a string value with a numeric column is reported by the engine when it sizes the segment.

## model.yaml

The semantic model: what the agent and the SQL workspace may read, and what words mean. Only tables listed here (plus the score table) can appear in a query.

```yaml
tables:
  entity_scores:
    description: One row per customer with precomputed scores
    columns:
      user_id: Customer id
      churn_risk: Risk of leaving, 0 to 1
  users:
    description: Customer profile
    columns:
      state: US state
joins:
  - entity_scores.user_id = users.id
synonyms:
  VIP: ltv_decile >= 9
  at risk: churn_risk > 0.7
```

| Field | Meaning |
|---|---|
| `tables.<name>.description` | One line on what a row is. |
| `tables.<name>.columns` | Column name to meaning, with units and allowed values. Columns not listed are still queryable; they just aren't explained to the agent. |
| `joins` | How tables relate, as `a.col = b.col` strings. |
| `synonyms` | Business term to SQL fragment. The agent is told to use them exactly. |

## golden.yaml

Verified question to SQL pairs. A question that matches one is answered from it without a model. They are also shown to the agent as examples (the closest few to the question asked) and used by `scorebase eval` to check the agent.

```yaml
- question: How many customers are at risk of leaving?
  sql: |
    SELECT COUNT(*) AS at_risk_customers
    FROM entity_scores
    WHERE churn_risk > 0.7
```

A question must be at least three characters and the SQL must pass the guard. Matching is by word overlap with stemming: a question is answered from a verified query only when every word it uses appears in the verified question, negations agree, and it covers at least 60% of the verified question's words. "Customers not at risk" and "VIPs in Texas" therefore go to the agent rather than to a near miss.

## Validation across files

Besides each file's shape, `scorebase validate` checks that `display.columns`, `display.highlight` and `display.default_sort` name scores or attributes, that every rule column is a score or attribute, that `entity_table` is a source, that `attributes` is only used with `entity_table`, and that `key` is not also a score name.
