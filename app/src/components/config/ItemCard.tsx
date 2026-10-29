import { ArrowDown, ArrowUp, ChevronRight, Copy, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, cx } from '../ui'

/** One entry in a config list: a summary row that expands, plus reorder, duplicate and delete. */
export function ItemCard({ title, subtitle, badges, open, onToggle, onUp, onDown, onDuplicate, onRemove, children }: {
  title: ReactNode
  subtitle?: ReactNode
  badges?: ReactNode
  open: boolean
  onToggle: () => void
  onUp?: () => void
  onDown?: () => void
  onDuplicate?: () => void
  onRemove?: () => void
  children: ReactNode
}) {
  return (
    <div className={cx('group bg-surface transition-colors', open && 'bg-subtle/40')}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-left">
          <ChevronRight className={cx('size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{title}</span>
            {subtitle && <span className="block truncate text-[12px] text-muted">{subtitle}</span>}
          </span>
        </button>
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">{badges}</div>
        <div className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="sm" onClick={onUp} disabled={!onUp} aria-label="Move up" icon={<ArrowUp />} />
          <Button variant="ghost" size="sm" onClick={onDown} disabled={!onDown} aria-label="Move down" icon={<ArrowDown />} />
          {onDuplicate && <Button variant="ghost" size="sm" onClick={onDuplicate} aria-label="Duplicate" icon={<Copy />} />}
          {onRemove && <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Delete" icon={<Trash2 />} className="hover:!text-danger" />}
        </div>
      </div>
      {open && <div className="anim-fade border-t border-line bg-surface px-4 py-4 sm:pl-10">{children}</div>}
    </div>
  )
}

/** A bordered list that ItemCards sit in, divided by lines. */
export function ItemList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">{children}</div>
}
