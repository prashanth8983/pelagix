const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const int = new Intl.NumberFormat('en-US')

export const money = (v?: number | null) => (v == null ? '—' : usd0.format(v))
export const count = (v?: number | null) => (v == null ? '—' : int.format(v))

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
