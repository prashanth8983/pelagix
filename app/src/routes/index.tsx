import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { AskBox } from '~/components/AskBox'
import { Distribution } from '~/components/Distribution'
import { ago, count } from '~/components/format'
import { MembersTable } from '~/components/MembersTable'
import { SegmentCards, type Segment } from '~/components/Segments'
import { ZeroShell } from '~/components/ZeroShell'
import { useRuns } from '~/components/config/state'
import { PageHeader, Skeleton } from '~/components/ui'
import { PROJECT } from '~/generated/project'

export const Route = createFileRoute('/')({
  validateSearch: z.object({ q: z.string().max(500).optional() }),
  component: Home,
})

const ALL: Segment = { name: 'all', label: PROJECT.entityLabel, rules: [], size: 0 }

function Home() {
  const { q } = Route.useSearch()
  const [segment, setSegment] = useState<Segment>(ALL)
  const { runs } = useRuns()
  const lastOk = runs.find((r) => r.status === 'ok' && r.steps.some((s) => s.step === 'publish'))

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            {segment.size ? `${count(segment.size)} ${PROJECT.entityLabel.toLowerCase()}` : PROJECT.entityLabel}
            {lastOk?.finished_at && <> · published {ago(lastOk.finished_at * 1000)}</>}
          </>
        }
      />
      <div className="space-y-6">
        <AskBox key={q} initial={q} />
        <ZeroShell fallback={<div className="space-y-6"><Skeleton className="h-[78px]" /><Skeleton className="h-96" /></div>}>
          <SegmentCards selected={segment.name} onSelect={setSegment} />
          <MembersTable segment={segment} />
        </ZeroShell>
        <Distribution />
      </div>
    </>
  )
}
