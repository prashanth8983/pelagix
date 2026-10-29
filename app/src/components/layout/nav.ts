import {
  BadgeCheck, BookOpenText, Database, FolderCog, Funnel, LayoutDashboard, ListChecks, Sigma, Sparkles, SquareTerminal,
  UserCog, Workflow, type LucideIcon,
} from 'lucide-react'

export type Role = 'viewer' | 'editor' | 'admin'
export type NavItem = { to: string; label: string; icon: LucideIcon }

export const NAV: { group: string; role: Role; items: NavItem[] }[] = [
  {
    group: 'Analyze',
    role: 'viewer',
    items: [
      { to: '/', label: 'Overview', icon: Sparkles },
      { to: '/dashboards', label: 'Dashboards', icon: LayoutDashboard },
      { to: '/explore', label: 'SQL workspace', icon: SquareTerminal },
    ],
  },
  {
    group: 'Configure',
    role: 'editor',
    items: [
      { to: '/configure', label: 'Setup', icon: ListChecks },
      { to: '/configure/project', label: 'Project', icon: FolderCog },
      { to: '/configure/sources', label: 'Sources', icon: Database },
      { to: '/configure/scores', label: 'Scores', icon: Sigma },
      { to: '/configure/segments', label: 'Segments', icon: Funnel },
      { to: '/configure/model', label: 'Semantic model', icon: BookOpenText },
      { to: '/configure/golden', label: 'Verified queries', icon: BadgeCheck },
    ],
  },
  { group: 'Operate', role: 'viewer', items: [{ to: '/runs', label: 'Pipeline runs', icon: Workflow }] },
  { group: 'Admin', role: 'admin', items: [{ to: '/admin/users', label: 'Users & audit', icon: UserCog }] },
]

export const pageTitle = (path: string): { group?: string; label: string } => {
  for (const g of NAV) for (const i of g.items) if (i.to === path) return { group: g.group, label: i.label }
  if (path === '/account') return { label: 'Account' }
  if (path.startsWith('/dashboards/')) return { group: 'Analyze', label: 'Dashboard' }
  return { label: 'Pelagix' }
}

