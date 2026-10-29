// Shared building blocks. Every color is a semantic token from styles.css, so both themes work.
import { AlertCircle, AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Info, Loader2, Plus, X } from 'lucide-react'
import {
  useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import type { Cell } from '~/lib/types'
import { cell } from '~/components/ui/format'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90 disabled:opacity-40',
  secondary: 'border border-line bg-surface text-fg shadow-[0_1px_0_rgb(0_0_0/0.03)] hover:bg-hover disabled:opacity-50',
  ghost: 'text-muted hover:bg-hover hover:text-fg disabled:opacity-40',
  danger: 'text-danger hover:bg-danger-subtle disabled:opacity-40',
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode; loading?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0',
        size === 'sm' ? 'h-7 px-2 text-[12px]' : 'h-8 px-3 text-[13px]',
        !children && (size === 'sm' ? 'w-7 px-0' : 'w-8 px-0'),
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Card({ title, description, actions, children, className, padded = true }:
  { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold">{title}</h2>
            {description && <p className="truncate text-[12px] text-muted">{description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Field({ label, hint, error, children, className }:
  { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="mb-1.5 block text-[12px] font-medium">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-danger">{error}</span>
        : hint && <span className="mt-1 block text-[12px] text-faint">{hint}</span>}
    </label>
  )
}

const control = 'w-full rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg placeholder:text-faint outline-none transition-[border-color,box-shadow] hover:border-line-strong focus:border-accent focus:ring-3 focus:ring-ring disabled:cursor-not-allowed disabled:bg-subtle disabled:text-faint'

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(control, 'h-8', className)} />
}

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(control, 'h-8 pr-7', className)}>{children}</select>
}

export function Code({ className, rows = 3, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea spellCheck={false} rows={rows} {...p} className={cx(control, 'py-2 font-mono text-[12px] leading-relaxed', className)} />
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5 text-[13px]">
      <span className={cx('relative h-[18px] w-8 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-[left]', checked ? 'left-4' : 'left-0.5')} />
      </span>
      {label}
    </button>
  )
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
const TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted',
  accent: 'bg-accent-subtle text-accent',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
}

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-[11px] font-medium', TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function Tabs<T extends string>({ value, onChange, options }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="inline-flex h-8 items-center rounded-md bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-7 rounded-[5px] px-2.5 text-[12px] font-medium transition-colors',
            value === o.value ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-9 place-items-center rounded-md border border-line bg-surface text-muted [&_svg]:size-4">{icon}</div>}
      <p className="text-[13px] font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

const CALLOUT = {
  info: { icon: Info, cls: 'border-line bg-subtle text-fg', iconCls: 'text-muted' },
  success: { icon: CheckCircle2, cls: 'border-success/25 bg-success-subtle text-fg', iconCls: 'text-success' },
  warning: { icon: AlertTriangle, cls: 'border-warning/25 bg-warning-subtle text-fg', iconCls: 'text-warning' },
  danger: { icon: AlertCircle, cls: 'border-danger/25 bg-danger-subtle text-fg', iconCls: 'text-danger' },
}

export function Callout({ tone = 'info', title, children, action, className }:
  { tone?: keyof typeof CALLOUT; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const c = CALLOUT[tone]
  const Icon = c.icon
  return (
    <div className={cx('flex gap-3 rounded-lg border px-3.5 py-3 text-[13px]', c.cls, className)}>
      <Icon className={cx('mt-0.5 size-4 shrink-0', c.iconCls)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx(title ? 'mt-0.5 text-muted' : '')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null
  return (
    <Callout tone="danger" title={errors.length === 1 ? 'One problem to fix' : `${errors.length} problems to fix`}>
      <ul className="mt-1 space-y-0.5">
        {errors.map((e) => <li key={e} className="font-mono text-[12px]">{e}</li>)}
      </ul>
    </Callout>
  )
}

export function Pre({ children, className }: { children: ReactNode; className?: string }) {
  return <pre className={cx('overflow-auto rounded-md border border-line bg-subtle p-3 font-mono text-[12px] leading-relaxed text-fg', className)}>{children}</pre>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1 font-sans text-[11px] text-muted">{children}</kbd>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-subtle', className)} />
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx('size-4 animate-spin text-muted', className)} />

export function Th({ children, align, className }: { children?: ReactNode; align?: 'right'; className?: string }) {
  return <th className={cx('h-9 whitespace-nowrap px-3 text-[12px] font-medium text-muted first:pl-4 last:pr-4', align === 'right' && 'text-right', className)}>{children}</th>
}

export type SortState = { col: number; dir: 'asc' | 'desc' } | null

export function DataTable({ columns, rows, max = 200, format, sort, onSort }:
  { columns: string[]; rows: Cell[][]; max?: number; format?: (col: string, v: Cell) => string; sort?: SortState; onSort?: (col: number) => void }) {
  const numeric = columns.map((_, j) => rows.length > 0 && rows.every((r) => r[j] == null || typeof r[j] === 'number'))
  return (
    <div className="max-h-[440px] overflow-auto rounded-md border border-line">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 z-[1] border-b border-line bg-subtle text-left">
          <tr>
            {columns.map((c, j) => (
              <Th key={c} align={numeric[j] ? 'right' : undefined}>
                {onSort ? (
                  <button onClick={() => onSort(j)} className={cx('inline-flex items-center gap-1 font-mono hover:text-fg', sort?.col === j && 'text-fg')}>
                    {c}
                    {sort?.col === j ? (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-30" />}
                  </button>
                ) : <span className="font-mono">{c}</span>}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, max).map((row, i) => (
            <tr key={i} className="hover:bg-hover">
              {row.map((v, j) => (
                <td key={j} className={cx('num h-9 whitespace-nowrap px-3 first:pl-4 last:pr-4', numeric[j] && 'text-right', v == null && 'text-faint')}>
                  {format ? format(columns[j], v) : cell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="border-t border-line px-4 py-2 text-[12px] text-muted">Showing {max} of {rows.length} rows</p>}
    </div>
  )
}

/** Edit a list of short strings as chips. */
export function TagInput({ value, onChange, placeholder, suggestions }:
  { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState('')
  const listId = useId()
  const add = (v: string) => {
    const t = v.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  return (
    <div className={cx(control, 'flex min-h-8 flex-wrap items-center gap-1 py-1 focus-within:border-accent focus-within:ring-3 focus-within:ring-ring')}>
      {value.map((v) => (
        <span key={v} className="inline-flex h-5 items-center gap-1 rounded bg-subtle pl-1.5 pr-0.5 font-mono text-[11px]">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded text-faint hover:text-fg">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={suggestions ? listId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? '' : placeholder}
        className="h-5 min-w-24 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-faint"
      />
      {suggestions && <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  )
}

/** Edit a string -> string map as rows. */
export function KeyValueEditor({ value, onChange, keyLabel = 'Key', valueLabel = 'Value', mono = false, addLabel = 'Add row' }:
  { value: Record<string, string>; onChange: (v: Record<string, string>) => void; keyLabel?: string; valueLabel?: string; mono?: boolean; addLabel?: string }) {
  const entries = Object.entries(value)
  const set = (i: number, k: string, v: string) => onChange(Object.fromEntries(entries.map((e, j) => (j === i ? [k, v] : e))))
  const grid = 'grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_32px] gap-2'
  return (
    <div className="space-y-1.5">
      {entries.length > 0 && (
        <div className={cx(grid, 'text-[12px] font-medium text-muted')}><span>{keyLabel}</span><span>{valueLabel}</span><span /></div>
      )}
      {entries.map(([k, v], i) => (
        <div key={i} className={grid}>
          <Input value={k} onChange={(e) => set(i, e.target.value, v)} className="font-mono text-[12px]" aria-label={keyLabel} />
          <Input value={v} onChange={(e) => set(i, k, e.target.value)} className={mono ? 'font-mono text-[12px]' : ''} aria-label={valueLabel} />
          <Button variant="ghost" aria-label="Remove" icon={<X />} onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} />
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={<Plus />} onClick={() => onChange({ ...value, [uniqueKey(value)]: '' })} className="-ml-2">{addLabel}</Button>
    </div>
  )
}

const uniqueKey = (o: Record<string, unknown>, base = 'new') => {
  let k = base, i = 1
  while (k in o) k = `${base}_${i++}`
  return k
}

export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Close on Escape and on a click outside `ref`. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const click = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose()
    window.addEventListener('keydown', key)
    window.addEventListener('mousedown', click)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('mousedown', click)
    }
  }, [open, onClose])
  return ref
}

/** A two-click confirm for destructive buttons, instead of a browser dialog. */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'Confirm', ...p }:
  Omit<Parameters<typeof Button>[0], 'onClick'> & { onConfirm: () => void; confirmLabel?: string }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Button {...p} variant={armed ? 'danger' : p.variant} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? confirmLabel : children}
    </Button>
  )
}
