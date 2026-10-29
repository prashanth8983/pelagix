// zero-cache calls this to turn a named query + args into a query it can sync.
// Anonymous, read-only demo: no user, and only the queries in queries.ts exist.
import { createFileRoute } from '@tanstack/react-router'
import { handleQueryRequest } from '@rocicorp/zero/server'
import { mustGetQuery } from '@rocicorp/zero'
import { queries } from '~/zero/queries'
import { schema } from '~/zero/schema'

export const Route = createFileRoute('/api/zero/query')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const result = await handleQueryRequest({
          handler: (name, args) => mustGetQuery(queries, name).fn({ args }),
          schema,
          request,
          userID: null,
        })
        return Response.json(result)
      },
    },
  },
})
