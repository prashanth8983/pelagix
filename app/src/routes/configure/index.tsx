// Setup: the six configuration files in the order a new project needs them, with the
// state of each, so an editor can see what is done and what is next.
import { Link, createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { ArrowRight, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SECTIONS, sectionErrors } from '~/components/config/sections'
import { useConfig, useRuns } from '~/components/config/state'
import { useToast } from '~/components/ui/Toaster'
import { Badge, Button, PageHeader, Skeleton } from '~/components/ui'
import type { Config, Section, WarehouseTable } from '~/lib/types'
import { warehouseTables } from '~/server/config'

export const Route = createFileRoute('/configure/')({ component: Setup })

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : word.endsWith('y') ? word.slice(0, -1) + 'ies' : word + 's'}`

/** One line of facts per section, from the config and the warehouse. */
function summary(section: Section, c: Config, tables: WarehouseTable[] | null): string {
  switch (section) {
    case 'project': {
      const parts = [`${c.project.entity ?? 'entity'} keyed by ${c.project.key}`, c.project.warehouse?.kind ?? 'duckdb']
      if (c.project.attributes?.length) parts.push(plural(c.project.attributes.length, 'attribute'))
      return parts.join(' · ')
    }
    case 'sources': {
      const n = c.sources.length
      if (!tables) return plural(n, 'source')
      const landed = c.sources.filter((s) => tables.some((t) => t.name === s.name)).length
      return `${plural(n, 'source')}, ${landed === n ? 'all' : landed} loaded`
    }
    case 'scores':
      return plural(c.scores.scores.length, 'score')
    case 'segments':
      return plural(c.segments.length, 'segment')
    case 'model': {
      const t = Object.keys(c.model.tables ?? {}).length
      const terms = Object.keys(c.model.synonyms ?? {}).length
      return `${plural(t, 'table')} described, ${plural(terms, 'business term')}`
    }
    case 'golden':
      return plural(c.golden.length, 'verified query')
  }
}

function Setup() {
  const { config, error } = useConfig()
  const { latest, start } = useRuns()
  const toast = useToast()
  const fetchTables = useServerFn(warehouseTables)
  const [tables, setTables] = useState<WarehouseTable[] | null>(null)
  useEffect(() => {
    fetchTables().then(setTables).catch(() => setTables([]))
  }, [fetchTables])

  // Shape errors come back without a section prefix (for example "0.path: ...").
  const known = new Set(SECTIONS.map((s) => s.section as string))
  const unplaced = (config?.errors ?? []).filter((e) => !known.has(e.split(/[.:]/)[0]))

  return (
    <>
      <PageHeader
        title="Setup"
        description="Each section is a YAML file under configs/."
        actions={
          <Button
            variant="primary"
            icon={<Play />}
            disabled={latest?.status === 'running' || (config?.errors.length ?? 0) > 0}
            onClick={async () => {
              const errs = await start()
              toast(errs ? { title: 'Run not started', description: errs.join('; '), tone: 'danger' } : { title: 'Pipeline run started', tone: 'success' })
            }}
          >
            Run pipeline
          </Button>
        }
      />

      {error && <p className="mb-5 text-[13px] text-danger">Engine API unreachable: {error}</p>}

      {!config ? (
        <div className="space-y-2">{SECTIONS.map((s) => <Skeleton key={s.section} className="h-16" />)}</div>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          {SECTIONS.map((s, i) => {
            const problems = sectionErrors(config.errors, s.section).length
            return (
              <li key={s.section}>
                <Link to={s.to} className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-hover">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-subtle text-[12px] font-semibold text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold">{s.title}</span>
                      <span className="font-mono text-[11px] text-faint">{s.file}</span>
                    </span>
                    <span className="block text-[12px] text-muted">{s.purpose}</span>
                  </span>
                  <span className="hidden text-[12px] text-muted sm:block">{summary(s.section, config, tables)}</span>
                  {problems > 0 ? <Badge tone="danger">{plural(problems, 'problem')}</Badge> : <Badge tone="success">Valid</Badge>}
                  <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            )
          })}
        </ol>
      )}

      {unplaced.length > 0 && (
        <div className="mt-4 rounded-lg border border-danger/25 bg-danger-subtle px-4 py-3 text-[12px]">
          <p className="font-medium">Problems in the files</p>
          <ul className="mt-1 space-y-0.5 font-mono">{unplaced.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <p className="mt-5 text-[12px] text-muted">
        {latest
          ? <>Last run {latest.status === 'running' ? 'is in progress' : latest.status === 'ok' ? 'succeeded' : 'failed'} {latest.finished_at ? `at ${new Date(latest.finished_at * 1000).toLocaleString()}` : ''}. <Link to="/runs" className="text-accent hover:underline">Pipeline runs</Link></>
          : <>No runs yet.</>}
      </p>
    </>
  )
}
