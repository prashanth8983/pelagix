import { useRouteContext } from '@tanstack/react-router'
import type { PublicUser } from '~/server/users'

const RANK = { viewer: 0, editor: 1, admin: 2 } as const

/** The signed-in user (root route context), and whether they hold at least a role. */
export function useMe(): { user: PublicUser | null; can: (role: keyof typeof RANK) => boolean } {
  const { session } = useRouteContext({ from: '__root__' })
  const user = session.user
  return { user, can: (role) => !!user && RANK[user.role] >= RANK[role] }
}
