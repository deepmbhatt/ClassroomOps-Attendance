import { Download, History } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, IconButton, PageHeader } from '../components/Layout'
import { loadAppData } from '../lib/api'

export function Audit() {
  const { data } = useQuery({ queryKey: ['app-data'], queryFn: loadAppData })
  return (
    <>
      <PageHeader eyebrow="Defensive layer" title="Audit history" action={<IconButton><Download size={16} />Export CSV</IconButton>}>
        Manual changes, imports, issue actions, and corrections are tracked with actor, timestamp, previous value, new value, and reason.
      </PageHeader>
      <Card>
        <div className="section-title"><div><p className="eyebrow">Recent changes</p><h2>Immutable trail</h2></div><History size={20} /></div>
        <table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Reason</th></tr></thead>
          <tbody>
            {data?.auditLogs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString()}</td>
                <td>{log.actor_name}</td>
                <td>{log.action}</td>
                <td>{log.entity_type} / {log.entity_id}</td>
                <td>{log.reason ?? 'Recorded by system policy'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
