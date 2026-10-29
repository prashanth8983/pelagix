import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AskBox } from '~/components/AskBox'
import { MembersTable } from '~/components/MembersTable'
import { SegmentCards, type Segment } from '~/components/Segments'
import { ZeroShell } from '~/components/ZeroShell'

export const Route = createFileRoute('/')({ component: Home })

const ALL: Segment = { name: 'all', label: 'Customers', rules: [], size: 0 }

function Home() {
  const [segment, setSegment] = useState<Segment>(ALL)

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[11px] text-white">S</span>
            Scorebase
          </div>
          <span className="text-[13px] text-muted">Retail · demo data</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-8">
        <AskBox />
        <ZeroShell fallback={<p className="text-sm text-muted">Connecting to sync…</p>}>
          <SegmentCards selected={segment.name} onSelect={setSegment} />
          <MembersTable segment={segment} />
        </ZeroShell>
      </main>
    </div>
  )
}
