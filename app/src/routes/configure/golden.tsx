import { Plus } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ItemCard } from '~/components/config/ItemCard'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useSection } from '~/components/config/state'
import { Badge, Button, Card, Code, DataTable, Field, Input } from '~/components/ui'
import { SqlEditor } from '~/components/Sql'
import { remove, replace } from '~/lib/edit'
import type { QueryResult } from '~/lib/types'
import { evalGolden, matchQuestion, runQuery } from '~/server/config'

export const Route = createFileRoute('/configure/golden')({ component: GoldenPage })

type Match = { question?: string; score?: number; verified?: boolean; unmatched?: string[] }

function GoldenPage() {
  const editor = useSection('golden')
  const runAll = useServerFn(evalGolden)
  const test = useServerFn(runQuery)
  const match = useServerFn(matchQuestion)
  const [open, setOpen] = useState<number | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; detail: string }>>({})
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState<Record<number, QueryResult | string>>({})
  const [probe, setProbe] = useState('')
  const [probeResult, setProbeResult] = useState<Match | null>(null)
  const items = editor.value ?? []

  const checkAll = async () => {
    setBusy(true)
    try {
      const r = await runAll()
      setResults(Object.fromEntries(r.map((x) => [x.question, { ok: x.ok, detail: x.error ?? `${x.rows} rows` }])))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionFrame
      section="golden"
      title="Verified queries"
      editor={editor}
      description="Questions with checked SQL. Matching questions are answered exactly, without a model."
      actions={<>
        <Button onClick={checkAll} disabled={busy}>{busy ? 'Checking…' : 'Check all saved'}</Button>
        <Button onClick={() => { editor.set((xs) => [...xs, { question: '', sql: 'SELECT ' }]); setOpen(items.length) }} icon={<Plus />}>New query</Button>
      </>}
    >
      <Card title="Match tester" className="mb-5">
        <p className="mb-3 text-[12px] text-muted">
          Type a question to see which verified query it would use. A question is answered from one only when it asks for nothing the
          verified question leaves out, so “customers not at risk” or “VIPs in Texas” go to the agent instead.
        </p>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (probe.trim()) setProbeResult(await match({ data: { question: probe } })) }}>
          <Input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="How many VIP customers are in Texas?" />
          <Button type="submit">Test</Button>
        </form>
        {probeResult && (
          <div className="mt-3 text-[13px]">
            {!probeResult.question ? <span className="text-muted">No verified query shares any words with that.</span> : (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={probeResult.verified ? 'success' : 'warning'}>{probeResult.verified ? 'Answered from' : 'Closest, not used'}</Badge>
                <span>“{probeResult.question}”</span>
                <span className="num text-muted">overlap {probeResult.score}</span>
                {!!probeResult.unmatched?.length && <span className="text-muted">· not covered: <span className="font-mono">{probeResult.unmatched.join(', ')}</span></span>}
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {items.map((g, i) => {
          const r = results[g.question]
          const t = tried[i]
          return (
            <ItemCard
              key={i}
              title={g.question || 'Untitled question'}
              subtitle={<span className="font-mono">{g.sql.replace(/\s+/g, ' ')}</span>}
              badges={r && <Badge tone={r.ok ? 'success' : 'danger'}>{r.ok ? r.detail : 'fails'}</Badge>}
              open={open === i}
              onToggle={() => setOpen(open === i ? null : i)}
              onRemove={() => editor.set((xs) => remove(xs, i))}
            >
              <div className="space-y-4">
                <Field label="Question"><Input value={g.question} onChange={(e) => editor.set((xs) => replace(xs, i, { ...g, question: e.target.value }))} /></Field>
                <Field label="SQL"><SqlEditor value={g.sql} minRows={6} onChange={(v) => editor.set((xs) => replace(xs, i, { ...g, sql: v }))} /></Field>
                {r && !r.ok && <p className="font-mono text-[12px] text-danger">{r.detail}</p>}
                <Button size="sm" onClick={async () => {
                  try {
                    const res = await test({ data: { sql: g.sql } })
                    setTried((x) => ({ ...x, [i]: res }))
                  } catch (e) {
                    setTried((x) => ({ ...x, [i]: (e as Error).message }))
                  }
                }}>Run this SQL</Button>
                {typeof t === 'string' && <p className="font-mono text-[12px] text-danger">{t}</p>}
                {t && typeof t !== 'string' && <DataTable columns={t.columns} rows={t.rows} max={20} />}
              </div>
            </ItemCard>
          )
        })}
      </div>
    </SectionFrame>
  )
}
