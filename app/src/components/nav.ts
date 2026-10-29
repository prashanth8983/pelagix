import {
  BookCheck, Database, Gauge, LayoutDashboard, Network, PlayCircle, Settings2, Shapes, TerminalSquare, Users,
  type LucideIcon,
} from 'lucide-react'

export type Role = 'viewer' | 'editor' | 'admin'
export type NavItem = { to: string; label: string; icon: LucideIcon }

export const NAV: { group: string; role: Role; items: NavItem[] }[] = [
  {
    group: 'Analyze',
    role: 'viewer',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/explore', label: 'SQL workspace', icon: TerminalSquare },
    ],
  },
  {
    group: 'Configure',
    role: 'editor',
    items: [
      { to: '/configure/project', label: 'Project', icon: Settings2 },
      { to: '/configure/sources', label: 'Sources', icon: Database },
      { to: '/configure/scores', label: 'Scores', icon: Gauge },
      { to: '/configure/segments', label: 'Segments', icon: Shapes },
      { to: '/configure/model', label: 'Semantic model', icon: Network },
      { to: '/configure/golden', label: 'Verified queries', icon: BookCheck },
    ],
  },
  { group: 'Operate', role: 'viewer', items: [{ to: '/runs', label: 'Pipeline runs', icon: PlayCircle }] },
  { group: 'Admin', role: 'admin', items: [{ to: '/admin/users', label: 'Users & audit', icon: Users }] },
]

export const pageTitle = (path: string): { group?: string; label: string } => {
  for (const g of NAV) for (const i of g.items) if (i.to === path) return { group: g.group, label: i.label }
  if (path === '/account') return { label: 'Account' }
  return { label: 'Scorebase' }
}

