import { useServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ask, type AskResponse } from '~/server/ask'
import { cell } from './format'

const SUGGESTIONS = [
  'Show high-value customers who haven’t ordered in 60 days',
  'Which traffic source brings the highest lifetime value?',
  'What is the churn risk distribution?',
]

// Two columns, the second numeric, few rows: draw it as a bar chart.
function chartable(r: AskResponse) {
  if (!r.columns || !r.rows || r.columns.length !== 2 || r.rows.length < 2 || r.rows.length > 30) return false
  return r.rows.every((row) => typeof row[1] === 'number')
}

export function AskBox() {
  const run = useServerFn(ask)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<AskResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showSql, setShowSql] = useState(false)

  const submit = async (question: string) => {
    if (!question.trim()) return
    setQ(question)
    setBusy(true)
    setErr(null)
    try {
      setRes(await run({ data: { question } }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-white">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(q)
        }}
        className="flex items-center gap-3 px-5 py-4"
      >
        <span className="text-muted">✦</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything about your customers…"
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-gray-400"
        />
        <kbd className="rounded border border-line px-1.5 text-xs text-muted">{busy ? '…' : '↵'}</kbd>
      </form>

      {!res && !busy && (
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-3">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="rounded-full border border-line px-3 py-1 text-[13px] text-muted hover:border-gray-300 hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {err && <p className="border-t border-line px-5 py-3 text-sm text-risk">{err}</p>}

      {res && (
        <div className="border-t border-line px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[15px]">{res.answer.replace(/\*\*/g, '')}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                res.source === 'verified' ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-accent'
              }`}
            >
              {res.source === 'verified' ? 'Verified query' : res.source === 'agent' ? 'AI generated' : 'No answer'}
            </span>
          </div>

          {res.rows && chartable(res) && (
            <div className="mt-4 h-56">
              <ResponsiveContainer>
                <BarChart data={res.rows.map((r) => ({ k: String(r[0]), v: r[1] as number }))}>
                  <XAxis dataKey="k" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip cursor={{ fill: '#f4f4f5' }} />
                  <Bar dataKey="v" name={res.columns![1]} fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {res.rows && !chartable(res) && (
            <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-[12px] text-muted">
                  <tr>{res.columns!.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {res.rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className="border-t border-line/70">
                      {row.map((v, j) => <td key={j} className="num px-3 py-1.5">{cell(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {res.sql && (
            <div className="mt-3">
              <button onClick={() => setShowSql(!showSql)} className="text-[13px] text-muted hover:text-ink">
                {showSql ? 'Hide SQL' : 'Show SQL'} · {res.rows?.length ?? 0} rows
              </button>
              {showSql && (
                <pre className="mt-2 overflow-auto rounded-lg bg-gray-50 p-3 text-[12px] leading-relaxed text-gray-700">
                  {res.sql}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
