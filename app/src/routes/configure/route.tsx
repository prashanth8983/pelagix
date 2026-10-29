import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

// Configuration is for editors and admins; the server functions check the same rule.
export const Route = createFileRoute('/configure')({
  beforeLoad: ({ context, location }) => {
    const role = context.session.user?.role
    if (role !== 'editor' && role !== 'admin') throw redirect({ to: '/' })
    if (location.pathname.replace(/\/$/, '') === '/configure') throw redirect({ to: '/configure/project' })
  },
  component: Outlet,
})
