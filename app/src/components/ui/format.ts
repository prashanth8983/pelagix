import { ATTRIBUTE_META, SCORES } from '~/generated/project'

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US')
const dec = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const day = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export const money = (v?: number | null) => (v == null ? '—' : usd0.format(v))
export const count = (v?: number | null) => (v == null ? '—' : int.format(v))
export const short = (v?: number | null) => (v == null ? '—' : compact.format(v))

export function ago(epochMs?: number | null): string {
  if (epochMs == null) return '—'
  const days = Math.floor((Date.now() - epochMs) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${(days / 365).toFixed(1)}y ago`
}

export function cell(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? int.format(v) : int.format(Math.round(v * 100) / 100)
  return String(v)
}

/** A value shown the way its score's `format` says. */
export function formatValue(format: string | undefined, v: unknown, opts: { precise?: boolean } = {}): string {
  if (v == null) return '—'
  if (typeof v !== 'number') return String(v)
  switch (format) {
    case 'money':
      return (opts.precise ? usd2 : usd0).format(v)
    case 'count':
      return int.format(v)
    case 'ratio':
      return `${Math.round(v * 100)}%`
    case 'percent':
      return `${dec.format(v)}%`
    case 'days':
      return `${int.format(v)}d`
    case 'date':
      return opts.precise ? day.format(new Date(v)) : ago(v)
    default:
      return Number.isInteger(v) ? int.format(v) : dec.format(v)
  }
}

/** Format any score-table column: scores by their format, attributes as text. */
export const formatScore = (name: string, v: unknown, opts?: { precise?: boolean }) =>
  name in SCORES ? formatValue(SCORES[name].format, v, opts) : v == null ? '—' : String(v)

export const isAttribute = (name: string) => name in ATTRIBUTE_META

export const scoreLabel = (name: string) => SCORES[name]?.label ?? ATTRIBUTE_META[name]?.label ?? name.replace(/_/g, ' ')
