import { createFileRoute } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useCallback, useState } from 'react'
import { z } from 'zod'
import { AskBox } from '~/components/overview/AskBox'
import { Distribution } from '~/components/overview/Distribution'
import { WaterScene } from '~/components/overview/Fish'
import { ago, count } from '~/components/ui/format'
import { MembersTable } from '~/components/overview/MembersTable'
import { SegmentList, type Segment } from '~/components/overview/Segments'
import { ZeroShell } from '~/components/layout/ZeroShell'
import { useRuns } from '~/components/config/state'
import { Skeleton, cx } from '~/components/ui'
import { PROJECT } from '~/generated/project'

export const Route = createFileRoute('/')({
  validateSearch: z.object({ q: z.string().max(500).optional() }),
  component: Home,
})

const ALL: Segment = { name: 'all', label: PROJECT.entityLabel, match: 'all', rules: [], size: 0 }

function Home() {
  const { q } = Route.useSearch()
  const [segment, setSegment] = useState<Segment>(ALL)
  const [asking, setAsking] = useState(!!q)
  const onActiveChange = useCallback((a: boolean) => setAsking(a), [])
  const { runs } = useRuns()
  const lastOk = runs.find((r) => r.status === 'ok' && r.steps.some((s) => s.step === 'publish'))
  const total = segment.name === 'all' ? segment.size : 0

  return (
    <>
      {/* The question comes first. Once one is asked, the hero shrinks so the answer sits under it. */}
      <section className={cx('flex flex-col items-center justify-center transition-[min-height] duration-300',
        asking ? 'min-h-0 pb-2' : 'min-h-[calc(100vh-9rem)] pb-16')}>
        {!asking && (
          <div className="anim-fade mb-2 text-center">
            <h1 className="text-[26px] font-semibold tracking-tight">What do you want to know?</h1>
            <p className="mt-1.5 text-[13px] text-muted">
              {total ? `${count(total)} ${PROJECT.entityLabel.toLowerCase()}` : PROJECT.entityLabel}
              {lastOk?.finished_at && <> · published {ago(lastOk.finished_at * 1000)}</>}
            </p>
          </div>
        )}
        {/* The water scene sits behind the Ask box, which floats on the surface. */}
        {!asking && <WaterScene className="anim-fade -mb-[72px]" />}
        <div className={cx('relative z-10 w-full transition-[max-width] duration-300', asking ? 'max-w-none' : 'max-w-2xl')}>
          <AskBox key={q} initial={q} hero={!asking} onActiveChange={onActiveChange} />
        </div>
        {!asking && (
          <button
            onClick={() => document.getElementById('customers')?.scrollIntoView({ behavior: 'smooth' })}
            className="anim-fade mt-14 flex flex-col items-center gap-1 text-[12px] text-faint transition-colors hover:text-fg"
          >
            Browse {PROJECT.entityLabel.toLowerCase()}
            <ChevronDown className="size-4 animate-bounce" />
          </button>
        )}
      </section>

      <section id="customers" className="scroll-mt-20 pt-8">
        <h2 className="mb-4 text-[15px] font-semibold tracking-tight">{PROJECT.entityLabel}</h2>
        {/* The members table takes the width; segments and the distribution sit in a rail beside it. */}
        <ZeroShell fallback={<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]"><Skeleton className="h-[640px]" /><Skeleton className="h-96" /></div>}>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <MembersTable key={segment.name} segment={segment} />
            <div className="space-y-6 xl:sticky xl:top-20">
              <SegmentList selected={segment.name} onSelect={setSegment} />
              <Distribution compact />
            </div>
          </div>
        </ZeroShell>
      </section>
    </>
  )
}
