// One score's distribution across every entity, from the warehouse.
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PROJECT } from '~/generated/project'
import { distribution } from '~/server/config'
import { SCORE_COLUMNS } from '~/zero/queries'
import { count, formatScore, scoreLabel, short } from '~/components/ui/format'
import { SERIES, axisTick, tooltipStyle } from '~/components/sql/ResultView'
import { Card, Select, Skeleton } from '~/components/ui'

type Bin = { bin: number; lo: number; hi: number; n: number }

export function Distribution({ compact = false }: { compact?: boolean }) {
  const fetchBins = useServerFn(distribution)
  const [column, setColumn] = useState<string>(SCORE_COLUMNS.find((c) => c === 'ltv') ?? SCORE_COLUMNS[0])
  const [bins, setBins] = useState<Bin[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setBins(null)
    fetchBins({ data: { column } })
      .then((r) => {
        setBins(r.rows.map((row) => ({ bin: row[0] as number, lo: row[1] as number, hi: row[2] as number, n: row[3] as number })))
        setErr(null)
      })
      .catch((e) => setErr((e as Error).message))
  }, [column, fetchBins])

  return (
    <Card
      title="Distribution"
      description={compact ? undefined : `${PROJECT.entityLabel} by ${scoreLabel(column).toLowerCase()}, values above the 99th percentile in the last bar`}
      actions={
        <Select value={column} onChange={(e) => setColumn(e.target.value)} className={compact ? '!h-7 w-32 text-[12px]' : 'w-40'} aria-label="Score">
          {SCORE_COLUMNS.map((c) => <option key={c} value={c}>{scoreLabel(c)}</option>)}
        </Select>
      }
    >
      {err ? <p className="text-[13px] text-danger">{err}</p> : !bins ? (
        <Skeleton className={compact ? 'h-40' : 'h-52'} />
      ) : (
        <div className={compact ? 'h-40' : 'h-52'}>
          <ResponsiveContainer>
            <BarChart data={bins} barCategoryGap={2} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="lo" tickFormatter={(v) => formatScore(column, v)} tick={axisTick} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis tickFormatter={(v) => short(v)} tick={axisTick} axisLine={false} tickLine={false} width={compact ? 32 : 40} />
              <Tooltip
                {...tooltipStyle}
                formatter={(v) => [count(v as number), PROJECT.entityLabel]}
                labelFormatter={(_, p) => {
                  const b = p?.[0]?.payload as Bin | undefined
                  return b ? `${formatScore(column, b.lo, { precise: true })} – ${formatScore(column, b.hi, { precise: true })}` : ''
                }}
              />
              <Bar dataKey="n" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
