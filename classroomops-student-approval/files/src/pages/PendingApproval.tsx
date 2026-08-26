import { Clock3, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'

export function PendingApproval() {
  const auth = useAuth()
  if (auth.role === 'admin' || auth.approvalStatus === 'approved') return <Navigate to="/" replace />

  const rejected = auth.approvalStatus === 'rejected'

  return (
    <div className="approval-page">
      <PageHeader eyebrow="Account verification" title={rejected ? 'Registration needs administrator attention' : 'Registration awaiting approval'}>
        {rejected
          ? 'Your registration was not approved. Contact your administrator to verify your Student ID and institutional email.'
          : 'Your account has been created. An administrator must verify your Student ID and assign at least one course before you can enter the portal.'}
      </PageHeader>
      <Card className="approval-card">
        <div className="approval-state-icon">{rejected ? <ShieldCheck size={30} /> : <Clock3 size={30} />}</div>
        <StatusPill tone={rejected ? 'danger' : 'warn'}>{auth.approvalStatus}</StatusPill>
        <h2>{rejected ? 'Contact the administrator' : 'No action is required right now'}</h2>
        <p>{rejected ? 'Ask the administrator to reopen and approve your registration.' : 'After approval, refresh this page and your courses, attendance, marks, and face registration will become available.'}</p>
        <div className="toolbar-actions">
          <IconButton className="primary" onClick={() => window.location.reload()}><RefreshCw size={16} />Check approval</IconButton>
          <IconButton onClick={() => void auth.signOut()}><LogOut size={16} />Sign out</IconButton>
        </div>
      </Card>
    </div>
  )
}
