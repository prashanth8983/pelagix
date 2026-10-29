// Transient confirmations ("Saved", "Run started") in the bottom-right corner.
import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cx } from '~/components/ui'

type Toast = { id: number; title: string; description?: string; tone: 'success' | 'danger' | 'neutral'; action?: { label: string; onClick: () => void } }
type Push = (t: Omit<Toast, 'id' | 'tone'> & { tone?: Toast['tone'] }) => void

const Ctx = createContext<Push>(() => {})
export const useToast = () => useContext(Ctx)

let seq = 0

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const close = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const push = useCallback<Push>((t) => {
    const id = ++seq
    setToasts((ts) => [...ts.slice(-3), { tone: 'neutral', ...t, id }])
    setTimeout(() => close(id), t.action ? 8000 : 4500)
  }, [close])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="anim-rise pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface p-3 shadow-lg shadow-black/5">
            {t.tone === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
            {t.tone === 'danger' && <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[12px] text-muted">{t.description}</p>}
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); close(t.id) }}
                  className={cx('mt-2 text-[12px] font-medium text-accent hover:underline')}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button aria-label="Dismiss" onClick={() => close(t.id)} className="text-faint hover:text-fg"><X className="size-3.5" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
