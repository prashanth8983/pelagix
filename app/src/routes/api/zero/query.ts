// zero-cache calls this to turn a named query + args into a query it can sync.
// zero-cache forwards the browser's cookies (ZERO_QUERY_FORWARD_COOKIES=true), so only a
// signed-in user's queries resolve, and only the queries in queries.ts exist.
import { createFileRoute } from '@tanstack/react-router'
import { handleQueryRequest } from '@rocicorp/zero/server'
import { mustGetQuery } from '@rocicorp/zero'
import { queries } from '~/zero/queries'
import { schema } from '~/zero/schema'

export const Route = createFileRoute('/api/zero/query')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { currentUser } = await import('~/server/auth')
        const user = await currentUser()
        if (!user) return Response.json({ error: 'Sign in to continue' }, { status: 401 })
        const result = await handleQueryRequest({
          handler: (name, args) => mustGetQuery(queries, name).fn({ args }),
          schema,
          request,
          userID: user.id,
        })
        return Response.json(result)
      },
    },
  },
})
