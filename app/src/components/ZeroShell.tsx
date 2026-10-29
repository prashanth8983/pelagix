// Zero runs in the browser only (it keeps a local copy of the synced rows),
// so render it after mount instead of during server rendering.
import { ZeroProvider } from '@rocicorp/zero/react'
import { useEffect, useState, type ReactNode } from 'react'
import { schema } from '~/zero/schema'

const cacheURL = import.meta.env.VITE_ZERO_CACHE_URL ?? 'http://localhost:4848'

export function ZeroShell({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <>{fallback}</>
  return (
    <ZeroProvider cacheURL={cacheURL} schema={schema}>
      {children}
    </ZeroProvider>
  )
}
