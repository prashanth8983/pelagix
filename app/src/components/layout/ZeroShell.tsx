// Zero runs in the browser only (it keeps a local copy of the synced rows),
// so render it after mount instead of during server rendering.
// The userID must match the one /api/zero/query reports for the session cookie.
import { ZeroProvider } from '@rocicorp/zero/react'
import { useEffect, useState, type ReactNode } from 'react'
import { useMe } from '~/lib/session'
import { schema } from '~/zero/schema'

const cacheURL = import.meta.env.VITE_ZERO_CACHE_URL ?? 'http://localhost:4848'

export function ZeroShell({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { user } = useMe()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || !user) return <>{fallback}</>
  return (
    <ZeroProvider cacheURL={cacheURL} schema={schema} userID={user.id}>
      {children}
    </ZeroProvider>
  )
}
