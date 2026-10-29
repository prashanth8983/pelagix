import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Play, Plus } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { DetailHeader, Group, MasterDetail, type ListItem } from '~/components/config/MasterDetail'
import { SectionFrame } from '~/components/config/SectionFrame'
import { useSection } from '~/components/config/state'
import { SqlEditor } from '~/components/sql/Sql'
import { Badge, Button, DataTable, Field, Input } from '~/components/ui'
import { errorsAt, move, remove, replace } from '~/lib/edit'
import type { QueryResult } from '~/lib/types'
import { evalGolden, matchQuestion, runQuery } from '~/server/config'

export const Route = createFileRoute('/configure/golden')({
  validateSearch: z.object({ item: z.union([z.string(), z.number()]).transform(String).optional() }),
  component: GoldenPage,
})

type Match = { question?: string; score?: number; verified?: boolean; unmatched?: string[] }

function GoldenPage() {
  const editor = useSection('golden')
  const { item } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const runAll = useServerFn(evalGolden)
  const test = useServerFn(runQuery)
  const match = useServerFn(matchQuestion)
  const [results, setResults] = useState<Record<string, { ok: boolean; detail: string }>>({})
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState<Record<number, QueryResult | string>>({})
  const [probe, setProbe] = useState('')
  const [probeResult, setProbeResult] = useState<Match | null>(null)
  const items = editor.value ?? []
  const errs = editor.errors
  const i = Math.min(Number(item ?? 0) || 0, Math.max(items.length - 1, 0))
  const selected = items.length ? String(i) : null
  const select = (key: string) => navigate({ search: { item: key }, replace: true })

  const checkAll = async () => {
    setBusy(true)
    try {
      const r = await runAll()
      setResults(Object.fromEntries(r.map((x) => [x.question, { ok: x.ok, detail: x.error ?? `${x.rows} rows` }])))
    } finally {
      setBusy(false)
    }
  }
  const add = () => {
    editor.set((xs) => [...xs, { question: '', sql: 'SELECT ' }])
    select(String(items.length))
  }

  const rows: ListItem[] = items.map((g, j) => {
    const r = results[g.question]
    const bad = errorsAt(errs, `${j}`)
    return {
      key: String(j),
      title: g.question || 'Untitled question',
      subtitle: g.sql.replace(/\s+/g, ' '),
      badge: bad ? 'invalid' : r ? (r.ok ? r.detail : 'fails') : undefined,
      tone: bad || (r && !r.ok) ? 'danger' : r ? 'accent' : 'neutral',
      text: `${g.question} ${g.sql}`,
    }
  })
  const g = items[i]
  const r = g ? results[g.question] : undefined
  const t = tried[i]

  return (
    <SectionFrame
      section="golden"
      title="Verified queries"
      editor={editor}
      actions={<>
        <Button onClick={checkAll} disabled={busy} loading={busy}>Check all saved</Button>
        <Button onClick={add} icon={<Plus />}>New query</Button>
      </>}
    >
      <form
        className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface shadow-card px-3 py-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (probe.trim()) setProbeResult(await match({ data: { question: probe } }))
        }}
      >
        <span className="text-[12px] font-medium">Match tester</span>
        <Input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Test a question" className="min-w-64 flex-1" />
        <Button type="submit" size="sm">Test</Button>
        {probeResult && (
          <span className="flex basis-full flex-wrap items-center gap-2 pt-1 text-[12px]">
            {!probeResult.question ? <span className="text-muted">No match.</span> : (
              <>
                <Badge tone={probeResult.verified ? 'success' : 'warning'}>{probeResult.verified ? 'Answered from' : 'Closest, not used'}</Badge>
                <span>“{probeResult.question}”</span>
                <span className="num text-muted">overlap {probeResult.score}</span>
                {!!probeResult.unmatched?.length && <span className="text-muted">not covered: <span className="font-mono">{probeResult.unmatched.join(', ')}</span></span>}
              </>
            )}
          </span>
        )}
      </form>

      <MasterDetail
        items={rows}
        selected={selected}
        onSelect={select}
        onNew={add}
        newLabel="New query"
        searchPlaceholder="Search questions"
        emptyTitle="No verified queries yet"
        emptyHint="Run a query in the SQL workspace and save it with the question it answers, or add one here."
      >
        {g && (
          <>
            <DetailHeader
              title={g.question || 'Untitled question'}
              subtitle={r ? (r.ok ? `Last check: ${r.detail}` : `Last check failed: ${r.detail}`) : undefined}
              onUp={i > 0 ? () => editor.set((xs) => move(xs, i, -1)) : undefined}
              onDown={i < items.length - 1 ? () => editor.set((xs) => move(xs, i, 1)) : undefined}
              onRemove={() => {
                editor.set((xs) => remove(xs, i))
                select(String(Math.max(0, i - 1)))
              }}
            />
            <Group title="Question" help="Written the way a person would ask it. Matching is by the words used, so include the ones that matter.">
              <Field label="Question" error={errorsAt(errs, `${i}.question`)}>
                <Input value={g.question} onChange={(e) => editor.set((xs) => replace(xs, i, { ...g, question: e.target.value }))} />
              </Field>
            </Group>
            <Group title="SQL" help="One SELECT over the tables in the semantic model. It runs through the same guard as everything else.">
              <Field label="SQL" error={errorsAt(errs, `${i}.sql`)}>
                <SqlEditor value={g.sql} minRows={6} onChange={(v) => editor.set((xs) => replace(xs, i, { ...g, sql: v }))} />
              </Field>
              <div className="mt-3">
                <Button size="sm" icon={<Play />} onClick={async () => {
                  try {
                    const res = await test({ data: { sql: g.sql } })
                    setTried((x) => ({ ...x, [i]: res }))
                  } catch (e) {
                    setTried((x) => ({ ...x, [i]: (e as Error).message }))
                  }
                }}>Run this SQL</Button>
              </div>
              {typeof t === 'string' && <p className="mt-3 font-mono text-[12px] text-danger">{t}</p>}
              {t && typeof t !== 'string' && <div className="mt-3"><DataTable columns={t.columns} rows={t.rows} max={20} /></div>}
            </Group>
          </>
        )}
      </MasterDetail>
    </SectionFrame>
  )
}
