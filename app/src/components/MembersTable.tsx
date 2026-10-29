import { useQuery } from '@rocicorp/zero/react'
import { useState } from 'react'
import { SCORE_COLUMNS, queries } from '~/zero/queries'
import type { Segment } from './Segments'
import { ago, count, money } from './format'

type SortCol = (typeof SCORE_COLUMNS)[number]

const COLUMNS: { key: SortCol; label: string; render: (r: Row) => string; align?: 'right' }[] = [
  { key: 'ltv', label: 'LTV', render: (r) => money(r.ltv), align: 'right' },
  { key: 'total_spend', label: 'Spent', render: (r) => money(r.total_spend), align: 'right' },
  { key: 'order_count', label: 'Orders', render: (r) => count(r.order_count), align: 'right' },
  { key: 'last_order_at', label: 'Last order', render: (r) => ago(r.last_order_at) },
]

type Row = {
  user_id: number
  ltv?: number | null
  total_spend?: number | null
  order_count?: number | null
  last_order_at?: number | null
  churn_risk?: number | null
}

function RiskBar({ value }: { value?: number | null }) {
  const v = value ?? 0
  const color = v > 0.7 ? 'bg-risk' : v > 0.4 ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${color}`} style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
      <span className="num w-8 text-xs text-muted">{Math.round(v * 100)}%</span>
    </div>
  )
}

export function MembersTable({ segment }: { segment: Segment }) {
  const [sortBy, setSortBy] = useState<SortCol>('ltv')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [rows, details] = useQuery(
    queries.scores.members({ rules: segment.rules as never, sortBy, sortDir, limit: 50 }),
  )

  const sort = (col: SortCol) => {
    if (col === sortBy) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else {
      setSortBy(col)
      setSortDir('desc')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
        <div>
          <span className="font-medium">{segment.label}</span>
          <span className="num ml-2 text-sm text-muted">{count(segment.size)} customers</span>
        </div>
        <span className="text-xs text-muted">
          {details.type === 'complete' ? 'Live · synced' : details.type === 'cached' ? 'Cached · syncing' : 'Syncing…'}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="px-5 py-2 font-medium">Customer</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className={`px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                <button onClick={() => sort(c.key)} className="hover:text-ink">
                  {c.label}
                  {sortBy === c.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
            <th className="px-5 py-2 font-medium">
              <button onClick={() => sort('churn_risk')} className="hover:text-ink">
                Churn risk{sortBy === 'churn_risk' ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id} className="border-t border-line/70 hover:bg-gray-50/70">
              <td className="num px-5 py-2.5 text-muted">#{r.user_id}</td>
              {COLUMNS.map((c) => (
                <td key={c.key} className={`num px-3 py-2.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.render(r)}
                </td>
              ))}
              <td className="px-5 py-2.5">
                <RiskBar value={r.churn_risk} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && details.type === 'complete' && (
        <p className="px-5 py-6 text-sm text-muted">No customers in this segment.</p>
      )}
    </div>
  )
}
