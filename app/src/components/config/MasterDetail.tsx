// A list on the left, the selected item's form on the right. Used by every list-based
// configuration page so they all work the same way: search, pick, edit, reorder.
import { ArrowDown, ArrowUp, Copy, Plus, Search, Trash2 } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, ConfirmButton, Empty, Input, cx } from '~/components/ui'

export type ListItem = {
  key: string
  title: ReactNode
  subtitle?: ReactNode
  /** Short status shown at the right of the row. */
  badge?: ReactNode
  tone?: 'neutral' | 'danger' | 'warning' | 'accent'
  /** Plain text used by the search box. */
  text: string
}

const DOT: Record<NonNullable<ListItem['tone']>, string> = {
  neutral: 'bg-line-strong', danger: 'bg-danger', warning: 'bg-warning', accent: 'bg-accent',
}

export function MasterDetail({ items, selected, onSelect, onNew, newLabel = 'New', searchPlaceholder = 'Search', emptyTitle, emptyHint, below, children }: {
  items: ListItem[]
  selected: string | null
  onSelect: (key: string) => void
  onNew?: () => void
  newLabel?: string
  searchPlaceholder?: string
  emptyTitle: string
  emptyHint?: ReactNode
  /** Extra content under the list, for example tables not yet in the model. */
  below?: ReactNode
  children: ReactNode
}) {
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const term = q.trim().toLowerCase()
  const shown = term ? items.filter((i) => i.text.toLowerCase().includes(term)) : items

  // Up and Down move the selection through the visible rows.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = shown.findIndex((x) => x.key === selected)
    const next = shown[e.key === 'ArrowDown' ? Math.min(i + 1, shown.length - 1) : Math.max(i - 1, 0)]
    if (next) {
      onSelect(next.key)
      listRef.current?.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(next.key)}"]`)?.focus()
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="self-start lg:sticky lg:top-20">
        <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
          <div className="flex items-center gap-2 border-b border-line p-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="pl-8" />
            </div>
            {onNew && <Button size="sm" icon={<Plus />} onClick={onNew} aria-label={newLabel} title={newLabel} />}
          </div>
          <div ref={listRef} role="listbox" aria-label="Items" onKeyDown={onKey} className="max-h-[calc(100vh-14rem)] overflow-y-auto py-1">
            {shown.length === 0 && (
              <p className="px-3 py-6 text-center text-[12px] text-muted">{items.length ? 'No matches' : 'Nothing here yet'}</p>
            )}
            {shown.map((i) => {
              const active = i.key === selected
              return (
                <button
                  key={i.key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-key={i.key}
                  onClick={() => onSelect(i.key)}
                  className={cx(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
                    active ? 'bg-accent-subtle text-fg' : 'hover:bg-hover',
                  )}
                >
                  <span className={cx('size-1.5 shrink-0 rounded-full', DOT[i.tone ?? 'neutral'])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{i.title}</span>
                    {i.subtitle && <span className="block truncate text-[11.5px] text-muted">{i.subtitle}</span>}
                  </span>
                  {i.badge && <span className="shrink-0 text-[11px] text-faint">{i.badge}</span>}
                </button>
              )
            })}
          </div>
          {below && <div className="border-t border-line">{below}</div>}
        </div>
      </aside>
      <div className="min-w-0">
        {selected && items.some((i) => i.key === selected) ? (
          <div key={selected} className="anim-fade space-y-5">{children}</div>
        ) : (
          <Empty title={emptyTitle} action={onNew && <Button icon={<Plus />} onClick={onNew}>{newLabel}</Button>}>{emptyHint}</Empty>
        )}
      </div>
    </div>
  )
}

/** The selected item's title row with reorder, duplicate and delete. */
export function DetailHeader({ title, subtitle, onUp, onDown, onDuplicate, onRemove, extra }: {
  title: ReactNode
  subtitle?: ReactNode
  onUp?: () => void
  onDown?: () => void
  onDuplicate?: () => void
  onRemove?: () => void
  extra?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-muted">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {extra}
        {(onUp || onDown) && (
          <>
            <Button variant="ghost" size="sm" onClick={onUp} disabled={!onUp} aria-label="Move up" title="Move up" icon={<ArrowUp />} />
            <Button variant="ghost" size="sm" onClick={onDown} disabled={!onDown} aria-label="Move down" title="Move down" icon={<ArrowDown />} />
          </>
        )}
        {onDuplicate && <Button variant="ghost" size="sm" onClick={onDuplicate} icon={<Copy />}>Duplicate</Button>}
        {onRemove && <ConfirmButton variant="ghost" size="sm" onConfirm={onRemove} icon={<Trash2 />} confirmLabel="Delete for sure">Delete</ConfirmButton>}
      </div>
    </div>
  )
}

/** A labeled group of fields with one line that says what the group is for. */
export function Group({ title, help, children, className }: { title: string; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface shadow-card', className)}>
      <header className="border-b border-line px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {help && <p className="text-[12px] text-muted">{help}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}
