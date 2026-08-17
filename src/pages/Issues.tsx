import { Check, MessageSquarePlus, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth'
import { Card, IconButton, PageHeader, StatusPill } from '../components/Layout'
import { loadAppData } from '../lib/api'

export function Issues() {
  const auth = useAuth()
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  const issues = auth.role === 'admin'
    ? data?.issues ?? []
    : data?.issues.filter((issue) => issue.student_id === 'student-1') ?? []
  return (
    <>
      <PageHeader
        eyebrow={auth.role === 'admin' ? 'Student support' : 'Report issue'}
        title={auth.role === 'admin' ? 'Issue dashboard' : 'My queries'}
        action={auth.role === 'student' ? <IconButton className="primary"><MessageSquarePlus size={16} />New issue</IconButton> : undefined}
      >
        Each query is attached to one attendance or mark record and moves from open to review to resolved.
      </PageHeader>
      <Card>
        <div className="table-toolbar">
          <label className="search-box"><Search size={16} /><input placeholder="Search issues by student or record" /></label>
        </div>
        <table>
          <thead><tr><th>Student</th><th>Record</th><th>Status</th><th>Message</th><th>Action</th></tr></thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id}>
                <td>{issue.student_name}</td>
                <td>{issue.target_type} / {issue.target_id}</td>
                <td><StatusPill tone={issue.status === 'resolved' ? 'good' : 'warn'}>{issue.status.replace('_', ' ')}</StatusPill></td>
                <td>{issue.message}</td>
                <td>{auth.role === 'admin' ? <IconButton><Check size={16} />Resolve</IconButton> : 'Waiting'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
