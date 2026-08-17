import {
  Bell,
  BookOpen,
  Camera,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  Gauge,
  History,
  LogOut,
  MessageSquareWarning,
  PanelLeft,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'
import type { Role } from '../types'

const adminLinks = [
  ['/', 'Dashboard', Gauge],
  ['/admin/students', 'Students', Users],
  ['/admin/biometrics', 'Biometrics', ShieldCheck],
  ['/admin/attendance', 'Terminal', Camera],
  ['/admin/marks', 'Marks & Imports', FileSpreadsheet],
  ['/admin/issues', 'Issues', MessageSquareWarning],
  ['/admin/audit', 'Audit', History],
] as const

const studentLinks = [
  ['/', 'Dashboard', Gauge],
  ['/student/face', 'Face Registration', Camera],
  ['/student/issues', 'Report Issues', MessageSquareWarning],
] as const

export function AppShell() {
  const auth = useAuth()
  const links = auth.role === 'admin' ? adminLinks : studentLinks
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><img src="/classroomops-logo.svg" alt="" /></span>
          <div>
            <strong>ClassroomOps</strong>
            <small>Facial attendance console</small>
          </div>
        </div>
        <RoleSwitch role={auth.role} setRole={auth.setRole} />
        <nav aria-label="Primary">
          {links.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          <span>Supabase-ready</span>
          <button className="icon-text ghost-on-dark" onClick={() => void auth.signOut()}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header className="mobile-topbar">
          <PanelLeft size={20} />
          <strong>ClassroomOps</strong>
        </header>
        <Outlet />
      </main>
    </div>
  )
}

function RoleSwitch({ role, setRole }: { role: Role; setRole(role: Role): void }) {
  return (
    <div className="role-switch" aria-label="Demo role switch">
      <button className={role === 'admin' ? 'active' : ''} onClick={() => setRole('admin')}>
        Admin
      </button>
      <button className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}>
        Student
      </button>
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children ? <p className="page-copy">{children}</p> : null}
      </div>
      {action}
    </header>
  )
}

export function Card({ children, className = '' }: React.PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`}>{children}</section>
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}

export function StatusPill({ children, tone = 'neutral' }: React.PropsWithChildren<{ tone?: 'good' | 'warn' | 'danger' | 'neutral' }>) {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />
}

export function Kpi({ label, value, icon }: { label: string; value: React.ReactNode; icon: React.ReactNode }) {
  return (
    <Card className="kpi">
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
    </Card>
  )
}

export function OnlineGate({ children }: React.PropsWithChildren) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return (
      <Card className="offline-blocker">
        <Database size={34} />
        <h2>Attendance is online-only in v1</h2>
        <p>Reconnect this classroom computer before starting or marking attendance.</p>
      </Card>
    )
  }
  return <>{children}</>
}

export function IconButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & React.PropsWithChildren) {
  return (
    <button className={`icon-text ${className}`} {...props}>
      {children}
    </button>
  )
}
