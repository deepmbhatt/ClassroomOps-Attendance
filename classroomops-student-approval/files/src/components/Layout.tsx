import {
  Camera,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Gauge,
  History,
  KeyRound,
  LogOut,
  Menu,
  MessageSquareWarning,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

const adminGroups = [
  { label: 'Overview', links: [['/', 'Dashboard', Gauge]] },
  {
    label: 'People & academics',
    links: [
      ['/admin/students', 'Courses & students', Users],
      ['/admin/marks', 'Assessments & marks', FileSpreadsheet],
      ['/admin/issues', 'Student requests', MessageSquareWarning],
    ],
  },
  {
    label: 'Attendance',
    links: [
      ['/admin/attendance', 'Live terminal', Camera],
      ['/admin/biometrics', 'Face enrollments', ShieldCheck],
      ['/admin/audit', 'Audit history', History],
    ],
  },
] as const

const studentGroups = [
  {
    label: 'My academics',
    links: [
      ['/', 'Home', Gauge],
      ['/student/face', 'Face registration', Camera],
      ['/student/issues', 'My requests', MessageSquareWarning],
    ],
  },
] as const

const routeNames: Record<string, string> = {
  '/': 'Dashboard',
  '/admin/students': 'Courses & students',
  '/admin/biometrics': 'Face enrollments',
  '/admin/attendance': 'Live terminal',
  '/admin/marks': 'Assessments & marks',
  '/admin/issues': 'Student requests',
  '/admin/audit': 'Audit history',
  '/student/face': 'Face registration',
  '/student/issues': 'My requests',
  '/change-password': 'Account security',
  '/pending-approval': 'Account approval',
}

export function AppShell() {
  const auth = useAuth()
  const location = useLocation()
  const groups = auth.role === 'admin' ? adminGroups : studentGroups
  const [menuOpen, setMenuOpen] = useState(false)
  const email = auth.session?.user.email ?? (auth.role === 'admin' ? 'Administrator' : 'Student')
  const initials = email.slice(0, 2).toUpperCase()

  useEffect(() => setMenuOpen(false), [location.pathname])

  return (
    <div className="app-shell">
      <button className={`sidebar-scrim ${menuOpen ? 'open' : ''}`} aria-label="Close navigation" onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-head">
          <NavLink className="brand" to="/" aria-label="ClassroomOps home">
            <span className="brand-mark"><img src="/classroomops-logo.svg" alt="" /></span>
            <div>
              <strong>ClassroomOps</strong>
              <small>{auth.role === 'admin' ? 'Administration console' : 'Student portal'}</small>
            </div>
          </NavLink>
          <button className="mobile-close" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        </div>
        <nav aria-label="Primary navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.links.map(([to, label, Icon]) => (
                <NavLink key={to} to={to} end={to === '/'}>
                  <Icon size={18} /><span>{label}</span><ChevronRight className="nav-chevron" size={15} />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="account-summary">
            <span className="account-avatar">{initials}</span>
            <span><strong>{auth.role === 'admin' ? 'Administrator' : 'Student account'}</strong><small>{email}</small></span>
          </div>
          <NavLink className="sidebar-action" to="/change-password"><KeyRound size={16} /><span>Account security</span></NavLink>
          <button className="sidebar-action" onClick={() => void auth.signOut()}><LogOut size={16} /><span>Sign out</span></button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="menu-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumb"><span>{auth.role === 'admin' ? 'Admin' : 'Student'}</span><ChevronRight size={14} /><strong>{routeNames[location.pathname] ?? 'ClassroomOps'}</strong></div>
          <div className="topbar-account"><span className="online-dot" /><span>Online</span><span className="account-avatar small">{initials}</span></div>
        </header>
        <main className="page-content"><Outlet /></main>
      </div>
    </div>
  )
}

export function PageHeader({ eyebrow, title, children, action }: { eyebrow: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children ? <p className="page-copy">{children}</p> : null}</div>
      {action ? <div className="page-actions">{action}</div> : null}
    </header>
  )
}

export function SectionTabs<T extends string>({ value, onChange, items }: { value: T; onChange(value: T): void; items: Array<{ value: T; label: string; icon?: React.ReactNode; count?: number }> }) {
  return (
    <div className="section-tabs" role="tablist">
      {items.map((item) => (
        <button key={item.value} type="button" role="tab" aria-selected={value === item.value} className={value === item.value ? 'active' : ''} onClick={() => onChange(item.value)}>
          {item.icon}{item.label}{typeof item.count === 'number' ? <span>{item.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Card({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`}>{children}</section>
}

export function EmptyState({ title, body, icon, action }: { title: string; body: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty-state">{icon ? <span className="empty-icon">{icon}</span> : null}<h2>{title}</h2><p>{body}</p>{action}</div>
}

export function StatusPill({ children, tone = 'neutral' }: React.PropsWithChildren<{ tone?: 'good' | 'warn' | 'danger' | 'neutral' }>) {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

export function Spinner() {
  return <div className="loading-screen"><div className="spinner" aria-label="Loading" /><p>Loading workspace...</p></div>
}

export function Kpi({ label, value, icon, detail }: { label: string; value: React.ReactNode; icon: React.ReactNode; detail?: string }) {
  return <Card className="kpi"><span className="kpi-icon">{icon}</span><small>{label}</small><strong>{value}</strong>{detail ? <p>{detail}</p> : null}</Card>
}

export function OnlineGate({ children }: React.PropsWithChildren) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return <Card className="offline-blocker"><Database size={34} /><h2>Internet connection required</h2><p>Reconnect this classroom computer before starting or marking attendance.</p></Card>
  }
  return <>{children}</>
}

export function IconButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & React.PropsWithChildren) {
  return <button className={`icon-text ${className}`} {...props}>{children}</button>
}

export function DataToolbar({ children }: React.PropsWithChildren) {
  return <div className="data-toolbar">{children}</div>
}
