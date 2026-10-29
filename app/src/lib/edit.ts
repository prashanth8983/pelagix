// Helpers for editing config drafts.
import type { Json } from './types'

export const move = <T,>(xs: T[], i: number, by: number): T[] => {
  const j = i + by
  if (j < 0 || j >= xs.length) return xs
  const out = [...xs]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

export const replace = <T,>(xs: T[], i: number, x: T): T[] => xs.map((y, j) => (j === i ? x : y))
export const remove = <T,>(xs: T[], i: number): T[] => xs.filter((_, j) => j !== i)

/** Drop empty strings, nulls and undefined from objects (the engine treats missing as default). */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (x === '' || x === null || x === undefined) continue
      const c = clean(x)
      if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue
      out[k] = c
    }
    return out as T
  }
  return v
}

/** A typed-in option value: true/false, numbers and JSON become values, the rest stays text. */
export function parseLiteral(s: string): Json {
  const t = s.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t)
  if (/^[[{]/.test(t)) {
    try {
      return JSON.parse(t)
    } catch {}
  }
  return s
}

export const showLiteral = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

export const uniqueName = (taken: string[], base: string) => {
  let n = base, i = 2
  while (taken.includes(n)) n = `${base}_${i++}`
  return n
}

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The engine reports problems as "path: message", where the path is dotted and
 * list items are indexes ("scores.2.sql", "0.rules.1.value", "segments.vip").
 * This returns the messages under one path, for showing next to a field.
 */
export function errorsAt(errors: string[], path: string): string | undefined {
  const found = errors
    .filter((e) => e.startsWith(path + ':') || e.startsWith(path + '.'))
    .map((e) => e.slice(e.indexOf(':') + 1).trim())
  return found.length ? found.join('; ') : undefined
}
