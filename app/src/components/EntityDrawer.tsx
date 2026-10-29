// Every score for one entity, live: a re-score that changes this row updates it in place.
import { useQuery } from '@rocicorp/zero/react'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { PROJECT, SCORES } from '~/generated/project'
import { queries } from '~/zero/queries'
import { formatScore, scoreLabel } from './format'
import { RatioBar } from './MembersTable'
import { Button, Skeleton } from './ui'

export function EntityDrawer({ entityKey, onClose }: { entityKey: string | number; onClose: () => void }) {
  const [row] = useQuery(queries.scores.one({ key: entityKey }))
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const r = row as Record<string, unknown> | undefined
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="anim-fade absolute inset-0 bg-overlay" />
      <aside
        role="dialog"
        aria-label={`${PROJECT.entity} ${entityKey}`}
        onClick={(e) => e.stopPropagation()}
        className="anim-slide absolute inset-y-2 right-2 flex w-[calc(100%-1rem)] max-w-md flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <p className="text-[12px] capitalize text-muted">{PROJECT.entity}</p>
            <h2 className="num mt-0.5 font-mono text-[17px] font-semibold">{String(entityKey)}</h2>
          </div>
          <Button variant="ghost" aria-label="Close" icon={<X />} onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto">
          {!r ? (
            <div className="space-y-3 p-5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : (
            <dl className="divide-y divide-line">
              {Object.keys(SCORES).map((name) => (
                <div key={name} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3">
                  <dt className="min-w-0">
                    <p className="text-[13px]">{scoreLabel(name)}</p>
                    {SCORES[name].description && <p className="truncate text-[12px] text-faint">{SCORES[name].description}</p>}
                  </dt>
                  <dd className="num text-right text-[13px] font-medium">
                    {SCORES[name].format === 'ratio' ? <RatioBar value={r[name] as number | null} /> : formatScore(name, r[name], { precise: true })}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {r && (
          <footer className="border-t border-line px-5 py-3 text-[12px] text-faint">
            Scored {r.scored_at ? new Date(r.scored_at as number).toLocaleString() : '—'}
          </footer>
        )}
      </aside>
    </div>
  )
}
