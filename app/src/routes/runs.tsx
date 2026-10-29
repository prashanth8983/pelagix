import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, ChevronRight, Circle, FlaskConical, Loader2, Play, PlayCircle, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useRuns } from '~/components/config/state'
import { Badge, Button, Empty, ErrorList, PageHeader, Pre, cx } from '~/components/ui'
import { useMe } from '~/lib/session'
import type { Run, Step } from '~/lib/types'

export const Route = createFileRoute('/runs')({ component: Runs })

const STEPS = ['load', 'check', 'score', 'segments', 'publish', 'codegen']
const STEP_HELP: Record<string, string> = {
  load: 'Land each source as a raw table',
  check: 'Run each source’s data checks',
  score: 'Build the score table',
  segments: 'Count every segment',
  publish: 'Write changed rows to Postgres',
  codegen: 'Update the app schema',
}

const when = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const took = (r: Run) => (r.finished_at ? `${(r.finished_at - r.started_at).toFixed(1)}s` : '')

function summary(s: Step): string {
  const r = s.result as unknown
  if (s.step === 'load' && r && typeof r === 'object') {
    return Object.entries(r as Record<string, number>).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(' · ')
  }
  if (s.step === 'segments' && Array.isArray(r)) return r.map((x: { label?: string; name: string; size: number }) => `${x.label ?? x.name} ${x.size.toLocaleString()}`).join(' · ')
  if (s.step === 'publish' && r && typeof r === 'object') {
    const p = r as { rows: number; written: number; deleted: number }
    return `${p.rows.toLocaleString()} rows, ${p.written.toLocaleString()} written, ${p.deleted.toLocaleString()} deleted`
  }
  if (s.step === 'check' && r && typeof r === 'object') return `${Object.keys(r).length} sources checked`
  return typeof r === 'string' ? r : ''
}

function StepRow({ name, step }: { name: string; step?: Step }) {
  const Icon = !step ? Circle : step.status === 'ok' ? CheckCircle2 : step.status === 'failed' ? XCircle : Loader2
  const tone = !step ? 'text-faint' : step.status === 'ok' ? 'text-success' : step.status === 'failed' ? 'text-danger' : 'text-accent animate-spin'
  return (
    <div className="grid grid-cols-[16px_80px_minmax(0,1fr)_56px] items-start gap-3 py-2.5 text-[13px]">
      <Icon className={cx('mt-0.5 size-4', tone)} strokeWidth={1.75} />
      <span className={cx('font-medium capitalize', !step && 'text-faint')}>{name}</span>
      <span className="min-w-0 text-muted">
        {step?.status === 'failed' ? <span className="whitespace-pre-wrap font-mono text-[12px] text-danger">{step.error}</span>
          : step ? <span className="block truncate" title={summary(step)}>{summary(step) || STEP_HELP[name]}</span> : STEP_HELP[name]}
      </span>
      <span className="num text-right text-muted">{step?.seconds != null ? `${step.seconds.toFixed(2)}s` : ''}</span>
    </div>
  )
}

function RunCard({ run, open, onToggle }: { run: Run; open: boolean; onToggle: () => void }) {
  const steps = Object.fromEntries(run.steps.map((s) => [s.step, s]))
  const shown = STEPS.filter((s) => steps[s] || run.status === 'running' || (s !== 'publish' && s !== 'codegen'))
  return (
    <div className="bg-surface">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-hover">
        <div className="flex min-w-0 items-center gap-3">
          <ChevronRight className={cx('size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
          <Badge dot tone={run.status === 'ok' ? 'success' : run.status === 'failed' ? 'danger' : 'accent'}>
            {run.status === 'ok' ? 'Succeeded' : run.status === 'failed' ? 'Failed' : 'Running'}
          </Badge>
          <span className="text-[13px]">{when(run.started_at)}</span>
          {!run.steps.some((x) => x.step === 'publish') && run.status !== 'running' && <Badge>Dry run</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="hidden font-mono text-[11px] text-faint sm:inline">{run.id}</span>
          <span className="num w-12 text-right text-[13px] text-muted">{took(run)}</span>
        </div>
      </button>
      {open && (
        <div className="anim-fade border-t border-line bg-subtle/40 px-4 py-1 sm:pl-11">
          <div className="divide-y divide-line">
            {shown.map((s) => <StepRow key={s} name={s} step={steps[s]} />)}
          </div>
          {run.error && !run.steps.some((s) => s.status === 'failed') && <div className="my-3"><ErrorList errors={[run.error]} /></div>}
          {run.log.length > 0 && (
            <details className="my-3">
              <summary className="cursor-pointer text-[12px] text-muted">Output ({run.log.length} lines)</summary>
              <Pre className="mt-2 max-h-64">{run.log.join('\n')}</Pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function Runs() {
  const { runs, start, latest } = useRuns()
  const { can } = useMe()
  const [open, setOpen] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const running = latest?.status === 'running'

  return (
    <>
      <PageHeader
        title="Pipeline runs"
        description="Load, check, score, segment, publish. A failed check stops the run before publishing."
        actions={can('editor') && (
          <>
            <Button icon={<FlaskConical />} disabled={running} onClick={async () => setErrors((await start(false)) ?? [])}>Dry run</Button>
            <Button variant="primary" icon={<Play />} loading={running} onClick={async () => setErrors((await start(true)) ?? [])}>
              {running ? 'Running' : 'Run pipeline'}
            </Button>
          </>
        )}
      />
      {errors.length > 0 && <div className="mb-5"><ErrorList errors={errors} /></div>}
      {runs.length === 0 ? (
        <Empty icon={<PlayCircle />} title="No runs yet">Start one here, or run <span className="font-mono">make score</span> from a terminal.</Empty>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {runs.map((r, i) => (
            <RunCard key={r.id} run={r} open={open === r.id || (open === null && i === 0)} onToggle={() => setOpen(open === r.id ? '' : r.id)} />
          ))}
        </div>
      )}
    </>
  )
}
